import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Enforces the rolling retention window on ErrorLog.
 *
 * The table is append-only and unbounded by construction, so something has to
 * delete from it or a quiet growth problem becomes a loud one months later.
 * Follows the same shape as the other sweeps in this codebase: run once at
 * boot, then on an interval, never throw, and never hold the process open.
 */
@Injectable()
export class ErrorLogRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  /** Bounded per pass so a long-neglected table cannot lock up one statement. */
  private static readonly BATCH = 5_000;

  private readonly logger = new Logger(ErrorLogRetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (!config.observability.errorLogs.enabled) return;
    await this.sweep();
    this.timer = setInterval(
      () => void this.sweep(),
      ErrorLogRetentionService.SWEEP_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The retention cut-off, as an absolute instant. */
  get cutoff(): Date {
    const { retentionDays } = config.observability.errorLogs;
    return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  }

  /** One pass. Idempotent, and never throws — it runs from a timer. */
  async sweep(): Promise<number> {
    const cutoff = this.cutoff;
    let removed = 0;

    try {
      // Loop so a backlog is cleared over several bounded statements rather
      // than one that holds locks for however long it takes.
      for (;;) {
        const stale = await this.prisma.errorLog.findMany({
          where: { occurredAt: { lt: cutoff } },
          select: { id: true },
          take: ErrorLogRetentionService.BATCH,
        });
        if (stale.length === 0) break;

        const { count } = await this.prisma.errorLog.deleteMany({
          where: { id: { in: stale.map((row) => row.id) } },
        });
        removed += count;

        if (stale.length < ErrorLogRetentionService.BATCH) break;
      }

      if (removed > 0) {
        this.logger.log(
          `error-log:pruned removed=${removed} olderThan=${cutoff.toISOString()}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `error-log:prune-failed error=${(error as Error).message}`,
      );
    }

    return removed;
  }
}
