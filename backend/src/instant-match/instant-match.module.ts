import { Module, OnModuleInit, Logger } from '@nestjs/common';
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

@Module({
  imports: [
    PrismaModule,
    MessagesModule,
    BullModule.registerQueue({ name: INSTANT_MATCH_QUEUE }),
  ],
  providers: [InstantMatchService, InstantMatchProcessor, InstantMatchRateLimiter],
  exports: [InstantMatchService, InstantMatchRateLimiter],
})
export class InstantMatchModule implements OnModuleInit {
  private readonly logger = new Logger(InstantMatchModule.name);

  constructor(
    @InjectQueue(INSTANT_MATCH_QUEUE) private readonly queue: Queue,
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
      this.logger.error(
        'Could not schedule the Instant Match expiry sweep — matches will only expire on response',
        err as any,
      );
    }
  }
}
