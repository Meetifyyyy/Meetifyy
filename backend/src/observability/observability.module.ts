import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SlowRequestMiddleware } from './slow-request.middleware';
import { SlowRequestRecorder } from './slow-request.recorder';
import { SlowRequestRetentionService } from './slow-request-retention.service';
import { ErrorLogRecorder } from './error-log.recorder';
import { ErrorLogRetentionService } from './error-log-retention.service';

/**
 * Slow-request and error capture, with their retention sweeps.
 *
 * The middleware is applied to every route from here rather than per
 * controller, so a route added later cannot end up silently unmeasured —
 * which is exactly the route you end up wanting data for.
 *
 * Global so the analytics API can read the recorder and the retention window
 * without importing this module and risking a cycle.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    SlowRequestRecorder,
    SlowRequestRetentionService,
    SlowRequestMiddleware,
    ErrorLogRecorder,
    ErrorLogRetentionService,
  ],
  exports: [
    SlowRequestRecorder,
    SlowRequestRetentionService,
    ErrorLogRecorder,
    ErrorLogRetentionService,
  ],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SlowRequestMiddleware).forRoutes('*');
  }
}
