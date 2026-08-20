import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { DevEmailController } from './dev-email.controller';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  // Dev controller only registers in non-production environments
  controllers: isDev ? [DevEmailController] : [],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService],
})
export class EmailModule {}
