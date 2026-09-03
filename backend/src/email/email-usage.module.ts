import { Module } from '@nestjs/common';

import { EmailUsageService } from './email-usage.service';
import { RedisModule } from '../redis/redis.module';

/**
 * The per-provider daily send counters, on their own.
 *
 * Separate from EmailModule because there are two very different reasons to
 * want them. EmailModule WRITES them as a side effect of sending, and carries
 * the queue, the worker, the Resend client and the SMTP transporter with it.
 * The admin analytics panel only READS them, and has no business depending on
 * the mail-sending machinery to do that — it would pull a BullMQ worker into
 * the import graph of a page that draws a card.
 *
 * Both import this; it needs nothing but Redis.
 */
@Module({
  imports: [RedisModule],
  providers: [EmailUsageService],
  exports: [EmailUsageService],
})
export class EmailUsageModule {}
