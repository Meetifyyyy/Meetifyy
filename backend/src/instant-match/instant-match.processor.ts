import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InstantMatchService } from './instant-match.service';

export const INSTANT_MATCH_QUEUE = 'instant-match';
export const JOB_EXPIRE_STALE = 'expire-stale';

/**
 * Runs the expiry sweep on the shared BullMQ queue rather than on a per-process
 * timer, so a multi-instance deployment reconciles each timed-out match exactly
 * once instead of emitting duplicate notifications from every replica.
 */
@Processor(INSTANT_MATCH_QUEUE)
export class InstantMatchProcessor extends WorkerHost {
  private readonly logger = new Logger(InstantMatchProcessor.name);

  constructor(private readonly instantMatchService: InstantMatchService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_EXPIRE_STALE) {
      await this.instantMatchService.expireStale();
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job?.name} failed: ${err?.message}`, err?.stack);
  }
}
