import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { errorMessage } from '../common/utils/error.util';

/** Jobs removed per Redis round trip; a short batch means nothing is left. */
export const EMAIL_CLEAN_BATCH = 1000;
/** Failed jobs older than this are dropped, matching removeOnFail.age. */
export const EMAIL_FAILED_GRACE_MS = 24 * 3600 * 1000;

type FinishedStatus = 'completed' | 'failed';

/**
 * Removes finished email jobs that predate EMAIL_QUEUE_DEFAULT_JOB_OPTIONS.
 *
 * BullMQ applies `removeOnComplete` / `removeOnFail` to jobs added after the
 * option exists and never goes back for the rest, so every email sent before
 * retention was configured still sits in Redis with its payload (one-time
 * codes, addresses, IPs). This clears them once. It is idempotent: on later
 * boots there is nothing left to remove, so it costs two empty `clean` calls.
 *
 * Uses the injected queue, so the environment's key prefix applies and one
 * environment can never clean another's jobs. Only counts are logged — a
 * payload must never reach a log.
 */
@Injectable()
export class EmailQueueJanitor implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailQueueJanitor.name);

  constructor(@InjectQueue('email') private readonly queue: Queue) {}

  onApplicationBootstrap(): void {
    // Fire-and-forget on purpose: with a large backlog this is many Redis
    // round trips, and boot (and the health check behind it) must not wait for
    // housekeeping. run() never rejects.
    void this.run();
  }

  /** Both phases, in order. Never throws. */
  async run(): Promise<void> {
    const completed = await this.drain('completed', 0);
    const failed = await this.drain('failed', EMAIL_FAILED_GRACE_MS);
    if (completed > 0 || failed > 0) {
      this.logger.log(
        `email.queue.janitor ${JSON.stringify({ completed, failed })}`,
      );
    }
  }

  /** Cleans one status in batches until a short batch; returns the total. */
  private async drain(
    status: FinishedStatus,
    graceMs: number,
  ): Promise<number> {
    let total = 0;
    try {
      let removed: number;
      do {
        const ids = await this.queue.clean(graceMs, EMAIL_CLEAN_BATCH, status);
        removed = ids.length;
        total += removed;
      } while (removed >= EMAIL_CLEAN_BATCH);
    } catch (err) {
      // A failed sweep leaves old jobs for the next boot. It must never be a
      // failed boot.
      this.logger.warn(
        `email queue clean (${status}) stopped after ${total}: ${errorMessage(err)}`,
      );
    }
    return total;
  }
}
