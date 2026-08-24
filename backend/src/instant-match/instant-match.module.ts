import { Module, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InstantMatchService } from './instant-match.service';
import { InstantMatchRateLimiter } from './instant-match.rate-limiter';
import {
  InstantMatchProcessor,
  INSTANT_MATCH_QUEUE,
  JOB_EXPIRE_STALE,
} from './instant-match.processor';
import { EXPIRY_SWEEP_MS } from './instant-match.constants';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagesModule } from '../messages/messages.module';
import { RedisModule } from '../redis/redis.module';
import { BlocksService } from '../users/blocks.service';

@Module({
  imports: [
    PrismaModule,
    MessagesModule,
    RedisModule,
    BullModule.registerQueue({ name: INSTANT_MATCH_QUEUE }),
  ],
  // BlocksService is provided here rather than by importing UsersModule (which
  // would drag in notifications, presence and a queue registration this module
  // has no use for). Its cache is deliberately static, so this copy shares one
  // map — and one Redis invalidation channel — with every other copy.
  providers: [InstantMatchService, InstantMatchProcessor, InstantMatchRateLimiter, BlocksService],
  exports: [InstantMatchService, InstantMatchRateLimiter],
})
export class InstantMatchModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstantMatchModule.name);

  /** In-process fallback sweep, armed only if BullMQ scheduling failed. */
  private fallbackTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectQueue(INSTANT_MATCH_QUEUE) private readonly queue: Queue,
    private readonly instantMatchService: InstantMatchService,
  ) {}

  async onModuleInit() {
    try {
      // Repeatable jobs are keyed by name + pattern, so re-registering on every
      // boot is a no-op rather than a duplicate schedule.
      await this.queue.add(
        JOB_EXPIRE_STALE,
        {},
        {
          repeat: { every: EXPIRY_SWEEP_MS },
          jobId: JOB_EXPIRE_STALE,
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      this.logger.log(`Instant Match expiry sweep scheduled every ${EXPIRY_SWEEP_MS}ms`);
    } catch (err) {
      // Without a sweep, an unanswered match never expires: both users stay
      // locked out of re-queueing and neither is put back in the queue. A
      // single-process timer is a worse sweep than the queue (it can double
      // up across replicas) but every transition it drives is claimed by a
      // conditional update, so duplicates are dropped rather than
      // double-notifying. Far better than no expiry at all.
      this.logger.error(
        'Could not schedule the Instant Match expiry sweep on the queue — ' +
        'falling back to an in-process timer',
        err as any,
      );
      this.fallbackTimer = setInterval(() => {
        void this.instantMatchService.expireStale().catch((sweepErr) => {
          this.logger.error('Fallback expiry sweep failed', sweepErr);
        });
      }, EXPIRY_SWEEP_MS);
      this.fallbackTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
  }
}
