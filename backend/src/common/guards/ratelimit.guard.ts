import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private ratelimit: RateLimiterRedis | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    const isProd = process.env.NODE_ENV === 'production';
    const redis = this.redisService.getClient();

    if (isProd && redis) {
      this.ratelimit = new RateLimiterRedis({
        storeClient: redis,
        points: 100, // 100 requests
        duration: 60, // per 60 seconds
        keyPrefix: 'ratelimit:global',
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.ratelimit) {
      return true; // Bypass if not configured
    }

    const request = context.switchToHttp().getRequest();
    const identifier = request.user?.id || request.ip || 'anonymous';

    try {
      await this.ratelimit.consume(identifier);
    } catch (e) {
      if (e instanceof Error) {
        // Log and fail open if redis is down
        console.warn('Rate limit check error (failing open)', e);
        return true;
      }
      
      // rate-limiter-flexible throws an object with remaining points etc. if limit is exceeded
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}
