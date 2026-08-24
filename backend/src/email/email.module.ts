import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { DevEmailController } from './dev-email.controller';

import { config } from '../config';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  // The email preview controller is registered only where the environment
  // enables development endpoints (never in production).
  controllers: config.features.enableDevEndpoints ? [DevEmailController] : [],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService],
})
export class EmailModule {}
