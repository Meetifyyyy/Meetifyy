import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import {
  AdminAnalyticsService,
  type SlowRequestSurface,
} from './admin-analytics.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

/**
 * Infrastructure and resource usage, read-only.
 *
 * Behind AdminJwtGuard like the rest of the admin surface: these responses name
 * hosts, bucket names and connection ceilings, which is not public information.
 */
@UseGuards(AdminJwtGuard)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('infrastructure')
  async getInfrastructure() {
    return this.analytics.getInfrastructure();
  }

  @Get('slow-requests')
  async getSlowRequests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('route') route?: string,
    @Query('method') method?: string,
    @Query('surface') surface?: SlowRequestSurface,
  ) {
    return this.analytics.getSlowRequests({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      route,
      method,
      surface,
    });
  }
}
