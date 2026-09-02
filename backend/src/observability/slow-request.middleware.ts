import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { config } from '../config';
import { SlowRequestRecorder } from './slow-request.recorder';

/**
 * Times every request and hands the slow ones to the recorder.
 *
 * Measurement is taken from the server's own clock around the real
 * request/response lifecycle — `finish` fires once the last byte is handed to
 * the socket — so the number is what the server actually spent, not what a
 * browser reported. Nothing is written on the request path: the recorder
 * buffers and flushes on its own schedule, so a slow request is never made
 * slower by being recorded.
 */
@Injectable()
export class SlowRequestMiddleware implements NestMiddleware {
  constructor(private readonly recorder: SlowRequestRecorder) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const { enabled, ignoredPrefixes, thresholdMs } =
      config.observability.slowRequests;

    if (!enabled) return next();

    const path = req.originalUrl || req.url || '';
    if (ignoredPrefixes.some((prefix) => path.startsWith(prefix))) {
      return next();
    }

    // `process.hrtime.bigint` is monotonic, so a clock adjustment mid-request
    // cannot produce a negative or wildly inflated duration.
    const startedAt = process.hrtime.bigint();

    res.once('finish', () => {
      const durationMs = Number(
        (process.hrtime.bigint() - startedAt) / 1_000_000n,
      );
      if (durationMs < thresholdMs) return;

      this.recorder.record({
        route: resolveRoute(req),
        path: path.split('?')[0],
        method: req.method,
        statusCode: res.statusCode,
        durationMs,
        requestId: headerValue(req, 'x-request-id'),
        // Set by whichever guard authenticated this request, if any.
        userId: (req as any).user?.id ?? null,
        adminId: (req as any).admin?.id ?? null,
        ip: clientIp(req),
        userAgent: headerValue(req, 'user-agent'),
        bytesOut: parseBytes(res.getHeader('content-length')),
      });
    });

    next();
  }
}

/**
 * The parameterised route, so `/admin/users/<uuid>` groups with every other
 * call to that handler instead of becoming its own row in the summary.
 *
 * Express fills `req.route` only after the router matches, which has happened
 * by the time `finish` fires. When it hasn't (a 404, or a request rejected by
 * middleware) the concrete path is the honest answer, with ids masked so the
 * grouping stays useful.
 */
export function resolveRoute(req: Request): string {
  const routePath = (req as any).route?.path;
  const baseUrl = req.baseUrl || '';
  if (routePath) return `${baseUrl}${routePath}`.slice(0, 300) || '/';

  return (req.originalUrl || req.url || '/')
    .split('?')[0]
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '/:id',
    )
    .replace(/\/\d+/g, '/:n')
    .slice(0, 300);
}

export function headerValue(req: Request, name: string): string | null {
  const value = req.headers[name];
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value).slice(0, 300);
}

/**
 * The first hop in `x-forwarded-for` is the client; the rest are proxies.
 * Falls back to the socket address when the app is not behind a proxy.
 */
export function clientIp(req: Request): string | null {
  const forwarded = headerValue(req, 'x-forwarded-for');
  const value = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  return value ? value.slice(0, 64) : null;
}

function parseBytes(header: number | string | string[] | undefined) {
  if (header === undefined) return null;
  const parsed = Number.parseInt(String(header), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
