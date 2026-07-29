import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { createHash } from 'crypto';
import { CACHE_CONTROL_KEY } from '../decorators/cache-control.decorator';
import { RedisService } from '../../redis/redis.service';
import Redis from 'ioredis';

@Injectable()
export class NoCacheInterceptor implements NestInterceptor {
  private readonly redis: Redis | null;

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.redis = this.redisService?.getClient() ?? null;
  }

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

    const checkEtagAndProceed = async (): Promise<{ is304: boolean; cachedEtag?: string }> => {
      if (ifNoneMatch && this.redis) {
        try {
          const cachedEtag = await this.redis.get(etagKey);
          if (cachedEtag && cachedEtag === ifNoneMatch) {
            return { is304: true, cachedEtag };
          }
        } catch {}
      }
      return { is304: false };
    };

    return from(checkEtagAndProceed()).pipe(
      switchMap(({ is304, cachedEtag }) => {
        if (is304 && cachedEtag) {
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

            if (this.redis) {
              this.redis.setex(etagKey, 60, etag).catch(() => {});
            }

            if (ifNoneMatch && ifNoneMatch === etag) {
              response.status(304);
              return null;
            }
            return body;
          }),
        );
      }),
    );
  }
}
