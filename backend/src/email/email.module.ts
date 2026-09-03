import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { EmailUsageModule } from './email-usage.module';
import { DevEmailController } from './dev-email.controller';
import { SupportEmailBuilder } from './support-email.builder';
import { PrismaModule } from '../prisma/prisma.module';
import { ACCOUNT_MAILER } from '../otp/account-mailer';

import { config } from '../config';

@Module({
  imports: [
    ConfigModule,
    // The support emails are rendered from the ticket rather than from the job
    // payload, so the worker needs database access.
    PrismaModule,
    // The per-provider daily counters the processor increments on each send.
    EmailUsageModule,
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  // The email preview controller is registered only where the environment
  // enables development endpoints (never in production).
  controllers: config.features.enableDevEndpoints ? [DevEmailController] : [],
  providers: [
    EmailService,
    EmailProcessor,
    SupportEmailBuilder,
    // Narrow alias of the same instance. Lets the account-deletion flow depend
    // on a two-method interface instead of importing this class, which would
    // drag `sanitize-html` (ESM) into its module graph — see account-mailer.ts.
    { provide: ACCOUNT_MAILER, useExisting: EmailService },
  ],
  // EmailUsageModule is re-exported rather than the service itself: this
  // module no longer provides it, it imports it.
  exports: [EmailUsageModule, EmailService, ACCOUNT_MAILER],
})
export class EmailModule {}
