import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { config } from '../config';
import { LOG_CAUSE } from '../common/logging/log-format';
import { MonitoringWriterService } from './services/monitoring-writer.service';
import { normalizeRoutePath, redactText } from './utils/redactor';

/**
 * Records one row per HTTP request, and an error row for anything that failed.
 *
 * Middleware on `res.finish` rather than a Nest interceptor, for coverage:
 * interceptors run *after* guards, so every request an auth guard rejects -
 * 401s, 403s, CSRF failures - would be invisible. Those are precisely the
 * requests worth seeing, since a spike in them is what a brute-force attempt
 * or a broken client looks like. `finish` fires for all of them, and for 404s
 * that matched no route at all.
 *
 * By the time `finish` fires Express has populated `req.route`, so the matched
 * *pattern* is still available - `/api/messages/:id` rather than
 * `/api/messages/8231`. That matters twice over: concrete ids fragment
 * per-endpoint aggregation, and ids are the part of a URL most likely to be
 * sensitive.
 *
 * The write itself is buffered, so the response never waits on monitoring.
 */
@Injectable()
export class RequestMonitoringMiddleware implements NestMiddleware {
  constructor(private readonly writer: MonitoringWriterService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (!config.monitoring.enabled) return next();

    const startedAt = process.hrtime.bigint();

    // `once`, not `on`: a listener left attached per request is a leak.
    response.once('finish', () => {
      try {
        this.record(request, response, startedAt);
      } catch {
        // Monitoring must never be able to break a request that has already
        // been served successfully.
      }
    });

    next();
  }

  private record(
    request: Request,
    response: Response,
    startedAt: bigint,
  ): void {
    const route = this.resolveRoute(request);
    if (this.isIgnored(route)) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const statusCode = response.statusCode ?? 0;
    const isError = statusCode >= 400;
    const isSlow = durationMs >= config.monitoring.slowRequestMs;

    // Errors and slow requests bypass sampling. A sampled error log makes a
    // real incident look intermittent, which is worse than not having one.
    if (!isError && !isSlow && !this.passesSample()) return;

    const requestId = this.requestIdOf(request);

    this.writer.recordRequest({
      requestId,
      method: String(request.method ?? 'GET').slice(0, 10),
      route,
      statusCode,
      durationMs: Math.round(durationMs),
      responseSize: this.responseSizeOf(response),
      // The only user-identifying value these tables may hold, and only when
      // the request actually authenticated.
      userId: (request as any).user?.id ?? (request as any).admin?.id ?? null,
    });

    if (isError) {
      this.writer.recordError({
        requestId,
        route,
        statusCode,
        // HttpExceptionFilter already stashes the refusal reason here, so the
        // real message is available without the filter needing to know that
        // monitoring exists.
        message: redactText(
          (request as any)[LOG_CAUSE] || `HTTP ${statusCode}`,
          2000,
        ),
        // Stack traces are opt-in: a stack can quote a source line containing
        // a value. Only ever read back by an admin.
        stack: config.monitoring.logStackTraces
          ? redactText((request as any).__logStack, 8000) || null
          : null,
      });
    }
  }

  /**
   * The matched route pattern, falling back to a normalized path.
   *
   * A request that matched no route (a 404) has no `req.route`, so those go
   * through the normalizer to keep ids out of the table.
   */
  private resolveRoute(request: Request): string {
    const pattern: string | undefined = (request as any).route?.path;
    if (pattern) {
      const base = typeof request.baseUrl === 'string' ? request.baseUrl : '';
      const full = `${base}${pattern}`.replace(/\/{2,}/g, '/');
      if (full) return full.slice(0, 300);
    }
    return normalizeRoutePath(request.originalUrl ?? request.url ?? '/');
  }

  private isIgnored(route: string): boolean {
    return config.monitoring.ignoredRoutePrefixes.some((prefix) =>
      route.startsWith(prefix),
    );
  }

  private passesSample(): boolean {
    const rate = config.monitoring.sampleRate;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return Math.random() < rate;
  }

  private responseSizeOf(response: Response): number | null {
    const header = response.getHeader?.('content-length');
    const parsed = Number(Array.isArray(header) ? header[0] : header);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Correlates this row with its error row and with the pino access log. */
  private requestIdOf(request: Request): string | null {
    const id = (request as any).id ?? request.headers?.['x-request-id'];
    return typeof id === 'string' ? id.slice(0, 100) : null;
  }
}
