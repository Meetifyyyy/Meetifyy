import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { RedisService } from '../../redis/redis.service';
import { config } from '../../config';

/**
 * Abuse control for the unauthenticated support endpoints.
 *
 * Two budgets, both of which must pass:
 *
 *  - per IP, which stops one host filling the queue;
 *  - per submitted email address, which stops a botnet spread across many IPs
 *    from mailing one victim's inbox a confirmation for every request it
 *    files. The confirmation email is sent to whatever address the form
 *    carries, so without this the endpoint is a mail amplifier pointed at an
 *    address the sender does not control.
 *
 * Consistent with the other guards in this directory: enforced wherever the
 * environment does not ask for relaxed limits, and failing open when Redis is
 * unavailable - a support form that refuses everyone is worse than one that is
 * briefly unmetered.
 */
@Injectable()
export class SupportRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(SupportRateLimitGuard.name);
  private byIp: RateLimiterRedis | null = null;
  private byEmail: RateLimiterRedis | null = null;

  constructor(private readonly redisService: RedisService) {
    const enforce = !config.features.relaxedRateLimits;
    const redis = this.redisService.getClient();
    if (!enforce || !redis) return;

    this.byIp = new RateLimiterRedis({
      storeClient: redis,
      points: 5,
      duration: 60 * 60, // 5 requests per hour per IP
      keyPrefix: 'ratelimit:support-ip',
    });

    this.byEmail = new RateLimiterRedis({
      storeClient: redis,
      points: 3,
      duration: 60 * 60, // 3 requests per hour per address
      keyPrefix: 'ratelimit:support-email',
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.byIp || !this.byEmail) return true;

    const request = context.switchToHttp().getRequest();
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      request.socket?.remoteAddress ||
      'anonymous';

    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : null;

    // Consumed together so a request that trips the second budget has still
    // spent a point against the first - otherwise the cheaper key could be
    // probed indefinitely.
    const budgets: Array<Promise<unknown>> = [this.byIp.consume(ip)];
    if (email) budgets.push(this.byEmail.consume(email));

    const outcomes = await Promise.allSettled(budgets);

    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') continue;
      if (outcome.reason instanceof Error) {
        this.logger.warn(`support.ratelimit_unavailable ${JSON.stringify({ error: outcome.reason.message })}`);
        continue; // Redis problem - fail open.
      }
      const retryAfterSeconds = Math.ceil((outcome.reason?.msBeforeNext ?? 60_000) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "You've sent several support requests recently. Please wait a little while before sending another.",
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
