import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SlowRequestMiddleware } from './slow-request.middleware';
import { SlowRequestRecorder } from './slow-request.recorder';
import { SlowRequestRetentionService } from './slow-request-retention.service';

/**
 * Slow-request capture and its retention sweep.
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
  ],
  exports: [SlowRequestRecorder, SlowRequestRetentionService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SlowRequestMiddleware).forRoutes('*');
  }
}
