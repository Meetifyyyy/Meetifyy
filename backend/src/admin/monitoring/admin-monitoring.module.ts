import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { MonitoringRateLimitGuard } from '../../common/guards/monitoring-ratelimit.guard';
import { AdminMonitoringController } from './admin-monitoring.controller';
import { AdminMonitoringService } from './admin-monitoring.service';

/**
 * The admin-facing half of monitoring. The collectors themselves live in
 * MonitoringModule, which is global, so this only needs the database and the
 * rate limiter's Redis client.
 */
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [AdminMonitoringController],
  providers: [AdminMonitoringService, MonitoringRateLimitGuard],
})
export class AdminMonitoringModule {}
