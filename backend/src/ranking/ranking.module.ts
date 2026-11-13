import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  registerInBackground,
  type BackgroundRegistration,
} from '../common/queues/background-registration';
import { registerProducerQueue } from '../common/queues/producer-queue';
import { Queue } from 'bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { TrendingService } from './trending.service';
import { TrendingController } from './trending.controller';
import { AffinityService } from './affinity.service';
import { AffinityProcessor } from './affinity.processor';
import {
  AFFINITY_REBUILD_MS,
  JOB_AFFINITY_REBUILD,
  RANKING_QUEUE,
} from './ranking.constants';

/**
 * Stage-2 personalisation: background jobs that precompute ranking inputs.
 *
 * Unlike the account-deletion sweep there is no in-process fallback when the
 * queue is unavailable. Affinity is an optional boost — the feed ranks without
 * it — so a missed rebuild degrades the feed slightly instead of breaking a
 * promise to a user.
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    registerProducerQueue({ name: RANKING_QUEUE }),
  ],
  controllers: [TrendingController],
  providers: [AffinityService, AffinityProcessor, TrendingService],
  exports: [AffinityService],
})
export class RankingModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RankingModule.name);
  private registration: BackgroundRegistration | null = null;

  constructor(@InjectQueue(RANKING_QUEUE) private readonly queue: Queue) {}

  onModuleInit(): void {
    // Behind boot, retried until Redis accepts it: with no fallback timer, a
    // registration that gave up would leave the rebuild unscheduled until the
    // next restart.
    this.registration = registerInBackground({
      description: 'the affinity rebuild',
      logger: this.logger,
      attempt: () =>
        // Keyed by name + interval, so re-registering on every boot is a no-op.
        this.queue.add(
          JOB_AFFINITY_REBUILD,
          {},
          {
            repeat: { every: AFFINITY_REBUILD_MS },
            jobId: JOB_AFFINITY_REBUILD,
            removeOnComplete: true,
            removeOnFail: 20,
          },
        ),
    });
  }

  onModuleDestroy(): void {
    this.registration?.stop();
  }
}
