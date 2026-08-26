import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { createHash } from 'crypto';
import { CACHE_CONTROL_KEY } from '../decorators/cache-control.decorator';

/**
 * Sets Cache-Control from the route's @CacheControl() decorator and answers
 * conditional GETs with a 304 when the response is byte-identical to what the
 * client already holds.
 *
 * The ETag is always derived from the response that was just produced. There
 * used to be a server-side store of previously-issued ETags, consulted *before*
 * running the handler: if the client's `If-None-Match` matched the stored value
 * the request 304'd without the handler ever executing.
 *
 * That store had no invalidation. Nothing — no mutation, no domain event —
 * ever evicted an entry, so for the 30-minute TTL the server kept insisting
 * "nothing has changed" about data that had. Every `private, no-cache` route
 * under /api/users is affected, which is why a changed avatar kept showing the
 * old image in profiles, share modals and invite modals, and why a hard reload
 * fixed it: a force refresh drops `If-None-Match`, so the handler finally ran.
 *
 * Running the handler and hashing its output still saves the response body on
 * the wire — the actual win — and it cannot go stale, because there is no
 * remembered state to go stale.
 */
@Injectable()
export class NoCacheInterceptor implements NestInterceptor {
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

    if (request.method !== 'GET') {
      return next.handle();
    }

    const ifNoneMatch = (request.headers['if-none-match'] || '').trim();

    return next.handle().pipe(
      map((body) => {
        if (body === null || body === undefined) return body;
        const json = typeof body === 'string' ? body : JSON.stringify(body);
        // Below this size the ETag round-trip costs more than the body saves.
        if (json.length < 512) {
          return body;
        }

        const etag = `"${createHash('md5').update(json).digest('hex').slice(0, 16)}"`;
        response.setHeader('ETag', etag);

        if (ifNoneMatch && ifNoneMatch === etag) {
          response.status(304);
          return null;
        }
        return body;
      }),
    );
  }
}
