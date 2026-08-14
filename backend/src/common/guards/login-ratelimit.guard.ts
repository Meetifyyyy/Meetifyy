import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { RedisService } from '../../redis/redis.service';

/**
 * Brute-force / credential-stuffing protection for the server-side login proxy.
 *
 * Because login is now proxied through this backend, Supabase sees only the
 * backend's IP for every attempt — its built-in per-IP throttling can no longer
 * distinguish callers. This guard restores per-client-IP limiting: a tight
 * budget of attempts per IP, keyed off the real client IP (x-forwarded-for).
 *
 * Consistent with the other limiters: active only in production with Redis, and
 * fails open if Redis is unavailable (availability > brittle lockouts).
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private ratelimit: RateLimiterRedis | null = null;

  constructor(private readonly redisService: RedisService) {
    const isProd = process.env.NODE_ENV === 'production';
    const redis = this.redisService.getClient();

    if (isProd && redis) {
      this.ratelimit = new RateLimiterRedis({
        storeClient: redis,
        points: 10, // 10 attempts
        duration: 300, // per 5 minutes, per IP
        blockDuration: 300, // then blocked for 5 minutes
        keyPrefix: 'ratelimit:login',
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.ratelimit) {
      return true; // Bypass in dev / without Redis
    }

    const request = context.switchToHttp().getRequest();
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      request.socket?.remoteAddress ||
      'anonymous';

    try {
      await this.ratelimit.consume(ip);
    } catch (e) {
      if (e instanceof Error) {
        // Redis error — fail open rather than lock users out.
        console.warn('Login rate limit check error (failing open)', e);
        return true;
      }
      throw new HttpException(
        'Too many login attempts. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
