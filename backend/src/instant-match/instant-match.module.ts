import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InstantMatchService } from './instant-match.service';
import { InstantMatchProcessor, INSTANT_MATCH_QUEUE, JOB_EXPIRE_STALE } from './instant-match.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    PrismaModule,
    MessagesModule,
    BullModule.registerQueue({ name: INSTANT_MATCH_QUEUE }),
  ],
  providers: [InstantMatchService, InstantMatchProcessor],
  exports: [InstantMatchService],
})
export class InstantMatchModule implements OnModuleInit {
  constructor(
    @InjectQueue(INSTANT_MATCH_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // Recurring job: expire stale queue entries and match sessions every 2 minutes
    await this.queue.add(
      JOB_EXPIRE_STALE,
      {},
      {
        repeat: { every: 2 * 60 * 1000 }, // 2 min
        jobId: 'expire-stale-recurring',
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
