import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private ratelimit: Ratelimit | null = null;

  constructor(private configService: ConfigService) {
    const isProd = process.env.NODE_ENV === 'production';
    const redisUrl = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const redisToken = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (isProd && redisUrl && redisToken && !redisUrl.includes('placeholder')) {
      const redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });

      this.ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(100, '60 s'),
        analytics: false,
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
      const { success } = await this.ratelimit.limit(identifier);

      if (!success) {
        throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (e) {
      if (e instanceof HttpException) {
        throw e;
      }
      // Log and fail open if redis is down
      console.warn('Rate limit check failed (failing open)', e);
    }

    return true;
  }
}
