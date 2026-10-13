import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AffinityService } from './affinity.service';
import { JOB_AFFINITY_REBUILD, RANKING_QUEUE } from './ranking.constants';

/** Runs the affinity rebuild on the shared queue, so a multi-replica
 *  deployment computes it once per interval rather than once per replica. */
@Processor(RANKING_QUEUE)
export class AffinityProcessor extends WorkerHost {
  private readonly logger = new Logger(AffinityProcessor.name);

  constructor(private readonly affinity: AffinityService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_AFFINITY_REBUILD) {
      await this.affinity.rebuildAll();
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Ranking job ${job?.name} failed: ${err?.message}`,
      err?.stack,
    );
  }
}
