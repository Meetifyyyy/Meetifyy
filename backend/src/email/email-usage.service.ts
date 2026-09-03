import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * How many emails this deployment has sent today, per provider.
 *
 * Counted here rather than read from the providers, because the two do not
 * offer the same thing: Brevo publishes an aggregated daily report, Resend has
 * no equivalent "sent today" figure at all. Counting our own sends gives one
 * number that means the same thing for both, is available the moment a send
 * succeeds, and does not depend on a provider API being reachable — which
 * matters most precisely when a provider is having a bad day.
 *
 * It counts what WE handed over successfully, which is not the same as what was
 * delivered. A provider's own dashboard is still the authority on bounces and
 * spam complaints; this answers "are we sending, and roughly how much".
 */
@Injectable()
export class EmailUsageService {
  private readonly logger = new Logger(EmailUsageService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * The calendar day in UTC.
   *
   * UTC deliberately, not local time: the counter has to agree with itself
   * across replicas that may sit in different regions, and a provider quota
   * that resets at midnight UTC is the thing being tracked against.
   */
  private dayKey(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  private key(provider: string, day = this.dayKey()): string {
    return `email:sent:${provider}:${day}`;
  }

  /**
   * Records one successful handover.
   *
   * Never throws and never awaits anything the caller depends on: a counter
   * that cannot be written must not turn a delivered email into a failed job.
   */
  async recordSent(provider: string): Promise<void> {
    const client = this.redisService.getClient();
    if (!client) return;
    const key = this.key(provider);
    try {
      // Expiry set alongside the increment so a key cannot outlive its week if
      // the process dies between the two. Eight days keeps yesterday readable
      // for comparison without accumulating history nobody reads.
      await client
        .multi()
        .incr(key)
        .expire(key, 8 * 24 * 60 * 60)
        .exec();
    } catch (error) {
      this.logger.warn(
        `email.usage_write_failed ${JSON.stringify({ provider, error: (error as Error).message })}`,
      );
    }
  }

  /**
   * Today's count for one provider, or null when Redis is unavailable.
   *
   * Null rather than 0: "we cannot tell you" and "nothing has been sent" are
   * different facts, and showing a confident zero during a Redis outage would
   * read as an email outage.
   */
  async getSentToday(provider: string): Promise<number | null> {
    const client = this.redisService.getClient();
    if (!client) return null;
    try {
      const raw = await client.get(this.key(provider));
      return raw === null ? 0 : Number.parseInt(raw, 10) || 0;
    } catch {
      return null;
    }
  }
}
