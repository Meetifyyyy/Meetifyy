import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { DevEmailController } from './dev-email.controller';
import { SupportEmailBuilder } from './support-email.builder';
import { PrismaModule } from '../prisma/prisma.module';

import { config } from '../config';

@Module({
  imports: [
    ConfigModule,
    // The support emails are rendered from the ticket rather than from the job
    // payload, so the worker needs database access.
    PrismaModule,
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  // The email preview controller is registered only where the environment
  // enables development endpoints (never in production).
  controllers: config.features.enableDevEndpoints ? [DevEmailController] : [],
  providers: [EmailService, EmailProcessor, SupportEmailBuilder],
  exports: [EmailService],
})
export class EmailModule {}
