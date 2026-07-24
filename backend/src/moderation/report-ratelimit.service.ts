import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

@Injectable()
export class ReportRateLimitService {
  private readonly logger = new Logger(ReportRateLimitService.name);
  private shortLimiter: Ratelimit | null = null;
  private dailyLimiter: Ratelimit | null = null;
  private monthlyLimiter: Ratelimit | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const redisToken = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (redisUrl && redisToken && !redisUrl.includes('placeholder')) {
      const redis = new Redis({ url: redisUrl, token: redisToken });

      // 5 reports per 10 minutes
      this.shortLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, '10 m'),
        prefix: 'ratelimit:report:short',
        analytics: false,
      });

      // 20 reports per 24 hours
      this.dailyLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, '24 h'),
        prefix: 'ratelimit:report:daily',
        analytics: false,
      });

      // 100 reports per 30 days
      this.monthlyLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(100, '30 d'),
        prefix: 'ratelimit:report:monthly',
        analytics: false,
      });
    }
  }

  async checkRateLimit(userId: string): Promise<{ success: boolean; limitType?: string }> {
    if (!this.shortLimiter || !this.dailyLimiter || !this.monthlyLimiter) {
      return { success: true }; // Fail open if Redis not configured
    }

    try {
      const shortRes = await this.shortLimiter.limit(userId);
      if (!shortRes.success) return { success: false, limitType: '10-minute (5 max)' };

      const dailyRes = await this.dailyLimiter.limit(userId);
      if (!dailyRes.success) return { success: false, limitType: 'daily (20 max)' };

      const monthlyRes = await this.monthlyLimiter.limit(userId);
      if (!monthlyRes.success) return { success: false, limitType: 'monthly (100 max)' };

      return { success: true };
    } catch (e) {
      this.logger.warn('Report rate limit check failed (failing open)', e);
      return { success: true };
    }
  }
}
