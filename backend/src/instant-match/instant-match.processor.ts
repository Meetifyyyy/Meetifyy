import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InstantMatchService } from './instant-match.service';

export const INSTANT_MATCH_QUEUE = 'instant-match';
export const JOB_EXPIRE_STALE = 'expire-stale';

@Processor(INSTANT_MATCH_QUEUE)
export class InstantMatchProcessor extends WorkerHost {
  private readonly logger = new Logger(InstantMatchProcessor.name);

  constructor(private readonly instantMatchService: InstantMatchService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_EXPIRE_STALE) {
      this.logger.debug('Running expire-stale job');
      await this.instantMatchService.expireStale();
    }
  }
}
