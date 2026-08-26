import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';

/**
 * Deletes monitoring rows older than the retention window.
 *
 * Runs on the same schedule with the same code in every environment; only
 * LOG_RETENTION_DAYS differs. Without this the tables grow without bound, and
 * on a shared Postgres instance that eventually degrades the application these
 * tables exist to observe.
 *
 * Scheduled with `setInterval` rather than a cron library, matching how the
 * rest of this codebase schedules recurring work, so the feature introduces no
 * new dependency.
 */
@Injectable()
export class MonitoringRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!config.monitoring.enabled) return;

    // Deliberately not run at boot: a deploy loop would then issue a delete
    // sweep per restart. The first pass happens one interval in.
    this.timer = setInterval(() => void this.prune(), config.monitoring.retentionIntervalMs);
    this.timer.unref?.();

    this.logger.log(
      `monitoring.retention_scheduled ${JSON.stringify({
        retentionDays: config.monitoring.retentionDays,
        everyMs: config.monitoring.retentionIntervalMs,
      })}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Removes everything older than the cutoff.
   *
   * Exposed so the admin API and the seed script can trigger a sweep without
   * waiting for the timer.
   */
  async prune(): Promise<{ requests: number; errors: number; metrics: number } | null> {
    if (this.running) return null;
    this.running = true;

    const cutoff = new Date(Date.now() - config.monitoring.retentionDays * 24 * 60 * 60 * 1000);
    const where = { createdAt: { lt: cutoff } };

    try {
      // Sequential rather than parallel: three concurrent bulk deletes hold
      // three connections and compete with live traffic for the same pool.
      const requests = await this.prisma.requestLog.deleteMany({ where });
      const errors = await this.prisma.errorLog.deleteMany({ where });
      const metrics = await this.prisma.systemMetric.deleteMany({ where });

      const result = { requests: requests.count, errors: errors.count, metrics: metrics.count };

      if (result.requests || result.errors || result.metrics) {
        this.logger.log(`monitoring.retention_pruned ${JSON.stringify({ cutoff: cutoff.toISOString(), ...result })}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`monitoring.retention_failed ${JSON.stringify({ error: (error as Error).message })}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
