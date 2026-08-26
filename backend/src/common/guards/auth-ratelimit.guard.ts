import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { RedisService } from '../../redis/redis.service';
import { config } from '../../config';

/**
 * Stricter, dedicated rate limiter for sensitive unauthenticated auth endpoints
 * (username/email availability checks, username→email lookup, reset-email probe).
 *
 * The global RateLimitGuard already applies a loose 100/min ceiling to every
 * route; these endpoints let a caller probe which accounts exist, so they get a
 * tighter per-IP budget on top. Keyed by client IP and namespaced separately so
 * it doesn't share points with the global limiter.
 *
 * Consistent with the global guard: only active in production with Redis, and
 * fails open if Redis is unavailable (availability > brittle blocking).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private ratelimit: RateLimiterRedis | null = null;

  constructor(private readonly redisService: RedisService) {
    // Enforced wherever the environment does not ask for relaxed limits —
    // always on in production, opt-in elsewhere.
    const enforce = !config.features.relaxedRateLimits;
    const redis = this.redisService.getClient();

    if (enforce && redis) {
      this.ratelimit = new RateLimiterRedis({
        storeClient: redis,
        points: 20, // 20 requests
        duration: 60, // per 60 seconds, per IP
        keyPrefix: 'ratelimit:auth-enum',
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.ratelimit) {
      return true; // Bypass if not configured (dev / no Redis)
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
        console.warn('Auth rate limit check error (failing open)', e);
        return true;
      }
      // rate-limiter-flexible throws a RateLimiterRes (not an Error) when exceeded.
      throw new HttpException(
        'Too many attempts. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
