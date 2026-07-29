import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { createHash } from 'crypto';
import { CACHE_CONTROL_KEY } from '../decorators/cache-control.decorator';

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

    // Generate ETags for cacheable GET responses so clients can send If-None-Match
    // and receive a 304 Not Modified instead of re-downloading unchanged payloads.
    const isCacheableGet = request.method === 'GET';
    if (!isCacheableGet) {
      return next.handle();
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

        const ifNoneMatch = (request.headers['if-none-match'] || '').trim();
        if (ifNoneMatch && ifNoneMatch === etag) {
          response.status(304);
          return null;
        }
        return body;
      }),
    );
  }
}
