import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';

import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { runOnOneReplica } from '../redis/run-on-one-replica';
import { traceBackground } from './background-trace';

/**
 * Enforces the rolling retention window on SlowRequest.
 *
 * The table is append-only and unbounded by construction, so something has to
 * delete from it or a quiet growth problem becomes a loud one months later.
 * Follows the same shape as the other sweeps in this codebase: run once at
 * boot, then on an interval, never throw, and never hold the process open.
 */
@Injectable()
export class SlowRequestRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  /** Well under the interval; only matters if the holder dies mid-sweep. */
  private static readonly LOCK_TTL_MS = 15 * 60 * 1000;
  /** Bounded per pass so a long-neglected table cannot lock up one statement. */
  private static readonly BATCH = 5_000;

  private readonly logger = new Logger(SlowRequestRetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!config.observability.slowRequests.enabled) return;
    await this.sweepOnOneReplica();
    this.timer = setInterval(
      () =>
        void traceBackground(
          { name: 'task slow-requests.retention-sweep', op: 'task' },
          () => this.sweepOnOneReplica(),
        ),
      SlowRequestRetentionService.SWEEP_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The retention cut-off, as an absolute instant. */
  get cutoff(): Date {
    const { retentionDays } = config.observability.slowRequests;
    return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  }

  /**
   * One pass, on one replica at a time. Every replica runs this at boot and on
   * its own timer; the lock only stops them overlapping on the same rows, since
   * the delete is safe to repeat.
   */
  private async sweepOnOneReplica(): Promise<void> {
    await runOnOneReplica(
      this.redis,
      'slow-requests:retention-sweep',
      SlowRequestRetentionService.LOCK_TTL_MS,
      () => this.sweep(),
    );
  }

  /** One pass. Idempotent, and never throws — it runs from a timer. */
  async sweep(): Promise<number> {
    const cutoff = this.cutoff;
    let removed = 0;

    try {
      // Loop so a backlog is cleared over several bounded statements rather
      // than one that holds locks for however long it takes.
      for (;;) {
        const stale = await this.prisma.slowRequest.findMany({
          where: { occurredAt: { lt: cutoff } },
          select: { id: true },
          take: SlowRequestRetentionService.BATCH,
        });
        if (stale.length === 0) break;

        const { count } = await this.prisma.slowRequest.deleteMany({
          where: { id: { in: stale.map((row) => row.id) } },
        });
        removed += count;

        if (stale.length < SlowRequestRetentionService.BATCH) break;
      }

      if (removed > 0) {
        this.logger.log(
          `slow-request:pruned removed=${removed} olderThan=${cutoff.toISOString()}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `slow-request:prune-failed error=${(error as Error).message}`,
      );
    }

    return removed;
  }
}
