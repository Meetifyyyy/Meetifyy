import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { registerProducerQueue } from '../common/queues/producer-queue';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { EmailQueueJanitor } from './email-queue-janitor';
import { EmailUsageModule } from './email-usage.module';
import { DevEmailController } from './dev-email.controller';
import { SupportEmailBuilder } from './support-email.builder';
import { PrismaModule } from '../prisma/prisma.module';
import { ACCOUNT_MAILER } from '../otp/account-mailer';
import { ADDRESS_MAILER } from '../otp/address-mailer';

import { config } from '../config';

/**
 * Retention for the email queue. BullMQ keeps finished jobs forever unless told
 * otherwise, and these payloads hold one-time codes, addresses and IPs, so a
 * sent job is dropped at once. A failed one is kept a day (and capped) so a
 * delivery problem can be diagnosed; any code in it expired long before that.
 * Per-job `attempts`/`backoff` are untouched: these are only the defaults.
 */
export const EMAIL_QUEUE_DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: { age: 24 * 3600, count: 1000 },
} as const;

@Module({
  imports: [
    ConfigModule,
    // The support emails are rendered from the ticket rather than from the job
    // payload, so the worker needs database access.
    PrismaModule,
    // The per-provider daily counters the processor increments on each send.
    EmailUsageModule,
    registerProducerQueue({
      name: 'email',
      defaultJobOptions: EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
    }),
  ],
  // The email preview controller is registered only where the environment
  // enables development endpoints (never in production).
  controllers: config.features.enableDevEndpoints ? [DevEmailController] : [],
  providers: [
    EmailService,
    EmailProcessor,
    SupportEmailBuilder,
    // Clears finished jobs left from before retention existed. Not registered
    // under Jest, where nothing should open a Redis connection at boot (the
    // same pattern as the dev controller above).
    ...(config.isTest ? [] : [EmailQueueJanitor]),
    // Narrow alias of the same instance. Lets the account-deletion flow depend
    // on a two-method interface instead of importing this class, which would
    // drag `sanitize-html` (ESM) into its module graph — see account-mailer.ts.
    { provide: ACCOUNT_MAILER, useExisting: EmailService },
    // Same alias, for the college- and personal-email verification flows.
    { provide: ADDRESS_MAILER, useExisting: EmailService },
  ],
  // EmailUsageModule is re-exported rather than the service itself: this
  // module no longer provides it, it imports it.
  exports: [EmailUsageModule, EmailService, ACCOUNT_MAILER, ADDRESS_MAILER],
})
export class EmailModule {}
