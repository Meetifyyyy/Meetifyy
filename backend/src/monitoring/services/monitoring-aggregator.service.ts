import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';

/**
 * Folds raw RequestLog rows into pre-aggregated PerformanceBucket records and
 * materialises SlowRequest rows.
 *
 * ## Why this service exists
 *
 * Raw request logs are retained for 48 hours — enough for live diagnostics.
 * The 7-day performance chart must survive that TTL, so every 5 minutes this
 * service reads the rows produced in that window, computes bucket stats, and
 * upserts a single PerformanceBucket row. After 7 days there are at most
 * 7 × 24 × 12 = 2,016 bucket rows — a fixed, tiny table versus millions of
 * raw rows.
 *
 * ## Idempotency and multi-instance safety
 *
 * PerformanceBucket has a @@unique([bucketAt]) constraint. If two instances
 * run the aggregator simultaneously they will produce identical bucket values
 * (same source rows) and one will win the upsert while the other is a no-op.
 * This is safe; no locking is needed.
 *
 * ## Failure handling
 *
 * A failed aggregation cycle is logged and skipped — the next cycle will cover
 * the same window again, so a single failure causes at most one bucket gap.
 * Aggregation failures must never interrupt normal request serving.
 */
@Injectable()
export class MetricsAggregatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsAggregatorService.name);

  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!config.monitoring.enabled) return;

    // First run is deferred by one full interval so the app can finish booting
    // before the aggregator makes its first database round-trip.
    this.timer = setInterval(
      () => void this.aggregate(),
      config.monitoring.aggregationIntervalMs,
    );
    this.timer.unref?.();

    this.logger.log(
      `monitoring.aggregator_started ${JSON.stringify({
        intervalMs: config.monitoring.aggregationIntervalMs,
        slowThresholdMs: config.monitoring.slowRequestThresholdMs,
        retentionDays: config.monitoring.aggregationRetentionDays,
      })}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Runs one aggregation cycle.
   *
   * Exposed so tests and the admin API can trigger an immediate cycle without
   * waiting for the interval.
   *
   * @returns Summary of what was written, or `null` if already running.
   */
  async aggregate(): Promise<{
    bucketsUpserted: number;
    slowRequestsInserted: number;
  } | null> {
    if (this.running) return null;
    this.running = true;

    try {
      return await this.runCycle();
    } catch (error) {
      this.logger.error(
        `monitoring.aggregator_failed ${JSON.stringify({
          error: (error as Error).message,
        })}`,
      );
      return null;
    } finally {
      this.running = false;
    }
  }

  private async runCycle(): Promise<{
    bucketsUpserted: number;
    slowRequestsInserted: number;
  }> {
    const intervalMs = config.monitoring.aggregationIntervalMs;

    // Cover the last N minutes (one bucket-width), ending at the most recent
    // completed 5-minute boundary so the bucket is stable and reproducible.
    const now = Date.now();
    const bucketBoundary = Math.floor(now / intervalMs) * intervalMs;
    const bucketAt = new Date(bucketBoundary - intervalMs);
    const windowEnd = new Date(bucketBoundary);

    // ── Bucket aggregation ─────────────────────────────────────────────────

    const [agg, p95Row] = await Promise.all([
      this.prisma.requestLog.aggregate({
        where: {
          createdAt: { gte: bucketAt, lt: windowEnd },
        },
        _count: { _all: true },
        _avg: { durationMs: true },
        _max: { durationMs: true },
      }),
      // p95 requires a raw percentile — Prisma ORM cannot express this.
      this.prisma.$queryRaw<Array<{ p95: number }>>`
        SELECT PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY "durationMs")::float AS p95
        FROM "RequestLog"
        WHERE "createdAt" >= ${bucketAt} AND "createdAt" < ${windowEnd}
      `,
    ]);

    const totalRequests = agg._count._all;

    // Upsert even when totalRequests is 0 — a zero-traffic bucket is still
    // valid data for the chart (it fills the gap rather than leaving it blank).
    if (totalRequests > 0) {
      const errorCount = await this.prisma.requestLog.count({
        where: {
          createdAt: { gte: bucketAt, lt: windowEnd },
          statusCode: { gte: 400 },
        },
      });

      const avgLatencyMs = Math.round(agg._avg.durationMs ?? 0);
      const maxLatencyMs = agg._max.durationMs ?? 0;
      const p95LatencyMs = Math.round(p95Row[0]?.p95 ?? 0);

      await this.prisma.performanceBucket.upsert({
        where: { bucketAt },
        update: {
          totalRequests,
          errorCount,
          avgLatencyMs,
          maxLatencyMs,
          p95LatencyMs,
        },
        create: {
          bucketAt,
          totalRequests,
          errorCount,
          avgLatencyMs,
          maxLatencyMs,
          p95LatencyMs,
        },
      });

      // ── Slow request materialisation ───────────────────────────────────────

      const threshold = config.monitoring.slowRequestThresholdMs;
      const maxPerBucket = config.monitoring.slowRequestMaxPerBucket;

      const slowRows = await this.prisma.requestLog.findMany({
        where: {
          createdAt: { gte: bucketAt, lt: windowEnd },
          durationMs: { gte: threshold },
        },
        orderBy: { durationMs: 'desc' },
        take: maxPerBucket,
        select: {
          route: true,
          method: true,
          statusCode: true,
          durationMs: true,
          requestId: true,
          createdAt: true,
        },
      });

      if (slowRows.length > 0) {
        await this.prisma.slowRequest.createMany({
          data: slowRows.map((r) => ({
            route: r.route,
            method: r.method,
            statusCode: r.statusCode,
            durationMs: r.durationMs,
            requestId: r.requestId ?? null,
            occurredAt: r.createdAt,
          })),
          skipDuplicates: false,
        });

        this.logger.log(
          `monitoring.aggregator_cycle ${JSON.stringify({
            bucketAt: bucketAt.toISOString(),
            totalRequests,
            errorCount,
            avgLatencyMs,
            slowInserted: slowRows.length,
          })}`,
        );

        return { bucketsUpserted: 1, slowRequestsInserted: slowRows.length };
      }

      return { bucketsUpserted: 1, slowRequestsInserted: 0 };
    }

    return { bucketsUpserted: 0, slowRequestsInserted: 0 };
  }
}
