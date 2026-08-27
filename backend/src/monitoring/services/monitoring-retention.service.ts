import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';

/**
 * Deletes monitoring rows older than their configured retention window.
 *
 * Manages four tables with two different retention policies:
 *
 *   Raw tables (48 hours by default):
 *     • RequestLog
 *     • ErrorLog
 *     • SystemMetric
 *
 *   Aggregated tables (7 days by default):
 *     • PerformanceBucket  (5-minute pre-computed stats)
 *     • SlowRequest        (materialised slow-request records)
 *
 * Scheduled with `setInterval` to match the rest of this codebase's
 * scheduler pattern. Runs every LOG_RETENTION_INTERVAL_MS (default 6 hours).
 *
 * Design notes:
 *   - Runs sequentially, not in parallel: three concurrent bulk deletes would
 *     compete for connection-pool slots with live traffic.
 *   - All deletes use the indexed `createdAt`/`occurredAt` columns so Postgres
 *     uses an index scan rather than a sequential scan.
 *   - Never loads expired rows into application memory — `deleteMany` with a
 *     `where` clause pushes the work entirely to the database engine.
 *   - A failed sweep is logged and skipped; it will be retried on the next
 *     interval. Monitoring failures must not crash the application.
 */
@Injectable()
export class MonitoringRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MonitoringRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!config.monitoring.enabled) return;

    // Deliberately not run at boot: a deploy loop would then issue a delete
    // sweep per restart. The first pass happens one interval in.
    this.timer = setInterval(
      () => void this.prune(),
      config.monitoring.retentionIntervalMs,
    );
    this.timer.unref?.();

    this.logger.log(
      `monitoring.retention_scheduled ${JSON.stringify({
        rawRetentionDays: config.monitoring.retentionDays,
        aggregationRetentionDays: config.monitoring.aggregationRetentionDays,
        everyMs: config.monitoring.retentionIntervalMs,
      })}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Removes records older than the configured cutoff for each table.
   *
   * Exposed so the admin API and seed scripts can trigger a sweep on demand
   * without waiting for the scheduled interval.
   *
   * @returns Row counts deleted per table, or `null` if already running.
   */
  async prune(): Promise<{
    requests: number;
    errors: number;
    metrics: number;
    buckets: number;
    slowRequests: number;
  } | null> {
    if (this.running) return null;
    this.running = true;

    const rawCutoff = new Date(
      Date.now() - config.monitoring.retentionDays * 24 * 60 * 60 * 1000,
    );
    const aggCutoff = new Date(
      Date.now() -
        config.monitoring.aggregationRetentionDays * 24 * 60 * 60 * 1000,
    );

    try {
      // Sequential — see class comment.
      const requests = await this.prisma.requestLog.deleteMany({
        where: { createdAt: { lt: rawCutoff } },
      });
      const errors = await this.prisma.errorLog.deleteMany({
        where: { createdAt: { lt: rawCutoff } },
      });
      const metrics = await this.prisma.systemMetric.deleteMany({
        where: { createdAt: { lt: rawCutoff } },
      });
      const buckets = await this.prisma.performanceBucket.deleteMany({
        where: { bucketAt: { lt: aggCutoff } },
      });
      const slowRequests = await this.prisma.slowRequest.deleteMany({
        where: { occurredAt: { lt: aggCutoff } },
      });

      const result = {
        requests: requests.count,
        errors: errors.count,
        metrics: metrics.count,
        buckets: buckets.count,
        slowRequests: slowRequests.count,
      };

      const anyDeleted = Object.values(result).some((n) => n > 0);
      if (anyDeleted) {
        this.logger.log(
          `monitoring.retention_pruned ${JSON.stringify({
            rawCutoff: rawCutoff.toISOString(),
            aggCutoff: aggCutoff.toISOString(),
            ...result,
          })}`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `monitoring.retention_failed ${JSON.stringify({
          error: (error as Error).message,
        })}`,
      );
      return null;
    } finally {
      this.running = false;
    }
  }
}
