import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportTargetResolver } from './report-target.resolver';
import { ReportRateLimitService } from './report-ratelimit.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    ReportTargetResolver,
    ReportRateLimitService,
    AdminGuard,
  ],
  exports: [ModerationService],
})
export class ModerationModule {}
