import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AccountDeletionPurgeService } from './account-deletion.purge.service';
import {
  ACCOUNT_DELETION_QUEUE,
  JOB_PURGE_SWEEP,
} from './account-deletion.constants';

/**
 * Runs the permanent-deletion sweep on the shared BullMQ queue rather than a
 * per-process timer, so a multi-replica deployment purges each expired account
 * once. The sweep is idempotent regardless — the claim step in the purge
 * service is what actually guarantees that — but keeping it on the queue means
 * replicas are not all doing the same scan every 15 minutes.
 */
@Processor(ACCOUNT_DELETION_QUEUE)
export class AccountDeletionProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountDeletionProcessor.name);

  constructor(private readonly purge: AccountDeletionPurgeService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_PURGE_SWEEP) {
      await this.purge.runSweep();
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Account-deletion job ${job?.name} failed: ${err?.message}`,
      err?.stack,
    );
  }
}
