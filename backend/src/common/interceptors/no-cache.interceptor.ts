import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { createHash } from 'crypto';
import { CACHE_CONTROL_KEY } from '../decorators/cache-control.decorator';

/**
 * ETag store TTL — matches the frontend's max gcTime (30 min) so a revalidation
 * still short-circuits even if the client hasn't fetched in a while.
 */
const ETAG_TTL_MS = 1800 * 1000;
const ETAG_MAX_ENTRIES = 20_000;

@Injectable()
export class NoCacheInterceptor implements NestInterceptor {
  /**
   * PERF: this store used to live in Redis, which put a blocking ~67ms
   * round-trip in front of *every* cacheable GET carrying `If-None-Match` —
   * i.e. essentially every browser revalidation, on a globally-registered
   * interceptor. It was spending 67ms to decide whether it could skip a handler
   * that (after the connection-pool fix) often costs less than that.
   *
   * An in-process map answers in ~0ms. On a multi-instance deployment an
   * instance that didn't serve the original response simply won't hold the
   * ETag and falls through to running the handler — which then recomputes the
   * ETag and still returns 304 when it matches. So the 304 shortcut degrades to
   * "one extra full response" across instances, never to a wrong answer.
   */
  private static readonly etagStore = new Map<string, { etag: string; expiresAt: number }>();

  private static getEtag(key: string): string | null {
    const hit = NoCacheInterceptor.etagStore.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.etag;
    if (hit) NoCacheInterceptor.etagStore.delete(key);
    return null;
  }

  private static setEtag(key: string, etag: string) {
    const store = NoCacheInterceptor.etagStore;
    if (store.size >= ETAG_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
      if (store.size >= ETAG_MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest) store.delete(oldest);
      }
    }
    store.set(key, { etag, expiresAt: Date.now() + ETAG_TTL_MS });
  }

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    // Read the @CacheControl() value from the route handler or controller.
    // Falls back to 'no-store' so any undecorated route is safe by default.
    const cacheControl =
      this.reflector.getAllAndOverride<string>(CACHE_CONTROL_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'no-store, no-cache, must-revalidate, proxy-revalidate';

    response.setHeader('Cache-Control', cacheControl);
    if (cacheControl.includes('no-store')) {
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Expires', '0');
      return next.handle();
    }

    // Fast ETag matching for GET responses
    const isCacheableGet = request.method === 'GET';
    if (!isCacheableGet) {
      return next.handle();
    }

    const ifNoneMatch = (request.headers['if-none-match'] || '').trim();
    const userId = request.user?.id || 'anon';
    const etagKey = `etag:${request.originalUrl || request.url}:${userId}`;

    // Synchronous lookup — no network hop on the critical path, so this no
    // longer delays the handler it is trying to avoid running.
    const cachedEtag = ifNoneMatch ? NoCacheInterceptor.getEtag(etagKey) : null;
    if (cachedEtag && cachedEtag === ifNoneMatch) {
      response.setHeader('ETag', cachedEtag);
      response.status(304);
      return of(null);
    }

    return next.handle().pipe(
      map((body) => {
        if (body === null || body === undefined) return body;
        const json = typeof body === 'string' ? body : JSON.stringify(body);
        if (json.length < 512) {
          return body;
        }

        const etag = `"${createHash('md5').update(json).digest('hex').slice(0, 16)}"`;
        response.setHeader('ETag', etag);
        NoCacheInterceptor.setEtag(etagKey, etag);

        if (ifNoneMatch && ifNoneMatch === etag) {
          response.status(304);
          return null;
        }
        return body;
      }),
    );
  }
}
