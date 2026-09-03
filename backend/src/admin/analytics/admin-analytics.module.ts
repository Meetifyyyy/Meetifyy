import { Module } from '@nestjs/common';

import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
// Read-only access to the per-provider send counters shown on the email cards.
import { EmailUsageModule } from '../../email/email-usage.module';

@Module({
  imports: [PrismaModule, RedisModule, EmailUsageModule],
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService],
})
export class AdminAnalyticsModule {}
