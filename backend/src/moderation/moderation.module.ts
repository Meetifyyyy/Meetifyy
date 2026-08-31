import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportTargetResolver } from './report-target.resolver';
import { ReportRateLimitService } from './report-ratelimit.service';
import { BullModule } from '@nestjs/bullmq';
import { ActivityAccessModule } from '../activities/activity-access.module';

@Module({
  imports: [
    PrismaModule,
    // The report flow must judge activity existence with the same policy the
    // rest of the app uses; the policy module is dependency-free so this adds
    // no coupling between feature modules.
    ActivityAccessModule,
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [ModerationController],
  providers: [ModerationService, ReportTargetResolver, ReportRateLimitService],
  exports: [ModerationService],
})
export class ModerationModule {}
