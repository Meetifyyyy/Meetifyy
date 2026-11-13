import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  registerInBackground,
  type BackgroundRegistration,
} from '../common/queues/background-registration';
import { registerProducerQueue } from '../common/queues/producer-queue';
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
import { AuthModule } from '../auth/auth.module';
import { traceBackground } from '../observability/background-trace';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    PresenceModule,
    UploadsModule,
    // Deletion and recovery are both gated on an emailed one-time code.
    UserOtpModule,
    EmailModule,
    // UserSessionService, to sign the account out of every device on purge.
    AuthModule,
    registerProducerQueue({ name: ACCOUNT_DELETION_QUEUE }),
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
  private registration: BackgroundRegistration | null = null;

  constructor(
    @InjectQueue(ACCOUNT_DELETION_QUEUE) private readonly queue: Queue,
    private readonly purge: AccountDeletionPurgeService,
  ) {}

  onModuleInit(): void {
    // Behind boot, retried until Redis accepts it: the sweep is what keeps the
    // 30-day deletion promise, so the registration must not give up.
    this.registration = registerInBackground({
      description: 'the account permanent-deletion sweep',
      logger: this.logger,
      attempt: async () => {
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
      },
      firstFailureNote: 'falling back to an in-process timer meanwhile',
      // Without a sweep, accounts past their 30 days are never actually
      // deleted — a data-retention promise silently unkept. An in-process
      // timer can double up across replicas, but every purge is claimed by a
      // conditional update, so a duplicate run is dropped rather than
      // double-deleting. Far better than no sweep at all.
      onFirstFailure: () => this.armFallbackTimer(),
    });
  }

  private armFallbackTimer(): void {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => {
      void traceBackground(
        { name: 'task account-deletion.purge-sweep', op: 'task' },
        () => this.purge.runSweep(),
      ).catch((sweepErr) => {
        this.logger.error('Fallback purge sweep failed', sweepErr);
      });
    }, PURGE_SWEEP_MS);
    this.fallbackTimer.unref?.();
  }

  onModuleDestroy() {
    this.registration?.stop();
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
  }
}
