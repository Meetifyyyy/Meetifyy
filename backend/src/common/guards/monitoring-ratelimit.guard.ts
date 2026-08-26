import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';

import { RedisService } from '../../redis/redis.service';
import { config } from '../../config';

/**
 * Budget for the monitoring API.
 *
 * These are the most expensive reads in the application - a 7-day window
 * aggregates across every request row - and the dashboard polls them on a
 * timer. A tab left open overnight, or several admins with the page open at
 * once, should not keep those aggregations running back to back.
 *
 * Keyed per admin rather than per IP: admins commonly share an office egress
 * address, and one admin's open dashboard must not lock out another's.
 *
 * Consistent with the other guards here: enforced wherever the environment
 * does not ask for relaxed limits, and failing open when Redis is unavailable,
 * since a monitoring page that refuses to load during an incident is the
 * opposite of useful.
 */
@Injectable()
export class MonitoringRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(MonitoringRateLimitGuard.name);
  private limiter: RateLimiterRedis | null = null;

  constructor(private readonly redisService: RedisService) {
    const enforce = !config.features.relaxedRateLimits;
    const redis = this.redisService.getClient();

    if (enforce && redis) {
      this.limiter = new RateLimiterRedis({
        storeClient: redis,
        points: config.monitoring.apiRateLimitPoints,
        duration: config.monitoring.apiRateLimitWindowSec,
        keyPrefix: 'ratelimit:admin-monitoring',
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.limiter) return true;

    const request = context.switchToHttp().getRequest();
    // AdminJwtGuard runs first and has already attached the admin.
    const key = request.admin?.id ?? request.ip ?? 'anonymous';

    try {
      await this.limiter.consume(key);
      return true;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.warn(`monitoring.ratelimit_unavailable ${JSON.stringify({ error: error.message })}`);
        return true;
      }
      throw new HttpException(
        'Monitoring queries are being requested too quickly. Slow the refresh interval and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
