import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { MonitoringRateLimitGuard } from '../../common/guards/monitoring-ratelimit.guard';
import { AdminMonitoringService } from './admin-monitoring.service';
import { ListErrorsDto, ListLogsDto, TimeseriesDto, WindowDto } from './dto/admin-monitoring.dto';

/**
 * Read-only monitoring API for the Admin Dashboard.
 *
 * Versioned in the path so the dashboard's data contract can change without
 * breaking a client that has not been redeployed alongside it.
 *
 * Guarded at the controller, not per handler, so a route added later cannot be
 * left unprotected by omission - these responses describe internal routes,
 * error messages and resource levels, and are for authenticated admins only.
 * The rate limiter is on top of the session check because these are the most
 * expensive queries in the application: a dashboard left open in a loop should
 * not be able to aggregate a week of rows continuously.
 */
@UseGuards(AdminJwtGuard, MonitoringRateLimitGuard)
@Controller('admin/monitoring/v1')
export class AdminMonitoringController {
  constructor(private readonly monitoring: AdminMonitoringService) {}

  @Get('overview')
  getOverview() {
    return this.monitoring.getOverview();
  }

  @Get('timeseries')
  getTimeseries(@Query() query: TimeseriesDto) {
    return this.monitoring.getTimeseries(query);
  }

  @Get('endpoints')
  getEndpoints(@Query() query: WindowDto) {
    return this.monitoring.getEndpoints(query.window);
  }

  @Get('logs')
  listLogs(@Query() query: ListLogsDto) {
    return this.monitoring.listLogs(query);
  }

  @Get('errors')
  listErrors(@Query() query: ListErrorsDto) {
    return this.monitoring.listErrors(query);
  }

  @Get('system')
  getSystem(@Query() query: WindowDto) {
    return this.monitoring.getSystem(query.window);
  }
}
