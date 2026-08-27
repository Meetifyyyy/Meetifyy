import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { MonitoringWriterService } from './services/monitoring-writer.service';
import { MonitoringRetentionService } from './services/monitoring-retention.service';
import { MetricsAggregatorService } from './services/monitoring-aggregator.service';
import { SocketMetricsCollector } from './services/socket-metrics.collector';
import { SystemMetricsCollector } from './services/system-metrics.collector';
import { RequestMonitoringMiddleware } from './request-monitoring.middleware';

/**
 * Application-level observability: request telemetry, error records,
 * periodic system snapshots, 5-minute performance aggregation, and
 * slow-request materialisation.
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
    MetricsAggregatorService,
    SocketMetricsCollector,
    SystemMetricsCollector,
  ],
  exports: [
    MonitoringWriterService,
    MonitoringRetentionService,
    MetricsAggregatorService,
    SocketMetricsCollector,
    SystemMetricsCollector,
  ],
})
export class MonitoringModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestMonitoringMiddleware).forRoutes('*');
  }
}
