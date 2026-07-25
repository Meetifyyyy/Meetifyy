import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ReportRateLimitService {
  private readonly logger = new Logger(ReportRateLimitService.name);
  private shortLimiter: RateLimiterRedis | null = null;
  private dailyLimiter: RateLimiterRedis | null = null;
  private monthlyLimiter: RateLimiterRedis | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    const redis = this.redisService.getClient();

    if (redis) {
      // 5 reports per 10 minutes (600s)
      this.shortLimiter = new RateLimiterRedis({
        storeClient: redis,
        points: 5,
        duration: 600,
        keyPrefix: 'ratelimit:report:short',
      });

      // 20 reports per 24 hours (86400s)
      this.dailyLimiter = new RateLimiterRedis({
        storeClient: redis,
        points: 20,
        duration: 86400,
        keyPrefix: 'ratelimit:report:daily',
      });

      // 100 reports per 30 days (2592000s)
      this.monthlyLimiter = new RateLimiterRedis({
        storeClient: redis,
        points: 100,
        duration: 2592000,
        keyPrefix: 'ratelimit:report:monthly',
      });
    }
  }

  async checkRateLimit(userId: string): Promise<{ success: boolean; limitType?: string }> {
    if (!this.shortLimiter || !this.dailyLimiter || !this.monthlyLimiter) {
      return { success: true }; // Fail open if Redis not configured
    }

    try {
      await this.shortLimiter.consume(userId);
    } catch (e) {
      if (e instanceof Error) {
        this.logger.warn('Report rate limit check failed (failing open)', e);
        return { success: true };
      }
      return { success: false, limitType: '10-minute (5 max)' };
    }

    try {
      await this.dailyLimiter.consume(userId);
    } catch (e) {
      if (e instanceof Error) return { success: true };
      return { success: false, limitType: 'daily (20 max)' };
    }

    try {
      await this.monthlyLimiter.consume(userId);
    } catch (e) {
      if (e instanceof Error) return { success: true };
      return { success: false, limitType: 'monthly (100 max)' };
    }

    return { success: true };
  }
}
