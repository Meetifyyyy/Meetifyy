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

  /**
   * Application errors from the retention window.
   *
   * Behind the same AdminJwtGuard as the rest of this controller, and for a
   * sharper reason than the others: these rows carry request paths, user ids
   * and stack frames.
   */
  @Get('error-logs')
  async getErrorLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('route') route?: string,
    @Query('severity') severity?: string,
    @Query('statusCode') statusCode?: string,
    @Query('search') search?: string,
  ) {
    const parsedStatus = statusCode ? parseInt(statusCode, 10) : NaN;
    return this.analytics.getErrorLogs({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      route,
      severity,
      statusCode: Number.isFinite(parsedStatus) ? parsedStatus : undefined,
      search,
    });
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
