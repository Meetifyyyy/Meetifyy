import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionPurgeService } from './account-deletion.purge.service';
import { AccountDeletionProcessor } from './account-deletion.processor';
import {
  ACCOUNT_DELETION_QUEUE,
  JOB_PURGE_SWEEP,
  PURGE_SWEEP_MS,
} from './account-deletion.constants';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { PresenceModule } from '../presence/presence.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UserOtpModule } from '../otp/user-otp.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    PresenceModule,
    UploadsModule,
    // Deletion and recovery are both gated on an emailed one-time code.
    UserOtpModule,
    EmailModule,
    BullModule.registerQueue({ name: ACCOUNT_DELETION_QUEUE }),
  ],
  controllers: [AccountDeletionController],
  providers: [
    AccountDeletionService,
    AccountDeletionPurgeService,
    AccountDeletionProcessor,
  ],
  exports: [AccountDeletionService, AccountDeletionPurgeService],
})
export class AccountDeletionModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionModule.name);
  private fallbackTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectQueue(ACCOUNT_DELETION_QUEUE) private readonly queue: Queue,
    private readonly purge: AccountDeletionPurgeService,
  ) {}

  async onModuleInit() {
    try {
      // Repeatable jobs are keyed by name + pattern, so re-registering every
      // boot is a no-op rather than a duplicate schedule.
      await this.queue.add(
        JOB_PURGE_SWEEP,
        {},
        {
          repeat: { every: PURGE_SWEEP_MS },
          jobId: JOB_PURGE_SWEEP,
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      this.logger.log(
        `Account permanent-deletion sweep scheduled every ${PURGE_SWEEP_MS}ms`,
      );
    } catch (err) {
      // Without a sweep, accounts past their 30 days are never actually
      // deleted — a data-retention promise silently unkept. An in-process
      // timer can double up across replicas, but every purge is claimed by a
      // conditional update, so a duplicate run is dropped rather than
      // double-deleting. Far better than no sweep at all.
      this.logger.error(
        'Could not schedule the account permanent-deletion sweep on the queue — ' +
          'falling back to an in-process timer',
        err,
      );
      this.fallbackTimer = setInterval(() => {
        void this.purge.runSweep().catch((sweepErr) => {
          this.logger.error('Fallback purge sweep failed', sweepErr);
        });
      }, PURGE_SWEEP_MS);
      this.fallbackTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
  }
}
