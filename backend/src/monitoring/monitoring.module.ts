import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { MonitoringWriterService } from './services/monitoring-writer.service';
import { MonitoringRetentionService } from './services/monitoring-retention.service';
import { SocketMetricsCollector } from './services/socket-metrics.collector';
import { SystemMetricsCollector } from './services/system-metrics.collector';
import { RequestMonitoringMiddleware } from './request-monitoring.middleware';

/**
 * Application-level observability: request telemetry, error records and
 * periodic system snapshots.
 *
 * Global because the realtime gateway needs SocketMetricsCollector and the
 * admin API needs the writer's buffer depth, without either importing this
 * module explicitly and risking a cycle.
 *
 * The middleware is applied to every route here rather than per controller, so
 * a route added later cannot end up silently unmonitored - which is exactly
 * when missing telemetry hurts most.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    MonitoringWriterService,
    MonitoringRetentionService,
    SocketMetricsCollector,
    SystemMetricsCollector,
  ],
  exports: [MonitoringWriterService, MonitoringRetentionService, SocketMetricsCollector, SystemMetricsCollector],
})
export class MonitoringModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestMonitoringMiddleware).forRoutes('*');
  }
}
