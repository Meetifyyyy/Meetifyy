import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';

/**
 * Buffers monitoring rows and writes them in batches.
 *
 * Nothing on the request path may wait on a monitoring insert. `record()` only
 * pushes onto an in-memory array and returns; the flush happens on a timer or
 * once a batch has filled, whichever comes first.
 *
 * Two failure modes are handled deliberately, because monitoring must never be
 * the thing that takes the application down:
 *
 *  - the buffer is capped, and overflows drop the *oldest* rows. An unbounded
 *    buffer during a database outage is a memory leak that ends in the process
 *    being killed, which is a far worse outcome than a gap in telemetry.
 *  - a failed flush is logged once and its rows discarded, not retried
 *    forever. Retrying into a database that is already struggling adds load to
 *    the exact thing that is failing.
 */
@Injectable()
export class MonitoringWriterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringWriterService.name);

  private requestBuffer: Prisma.RequestLogCreateManyInput[] = [];
  private errorBuffer: Prisma.ErrorLogCreateManyInput[] = [];
  private metricBuffer: Prisma.SystemMetricCreateManyInput[] = [];

  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private droppedSinceLastReport = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!config.monitoring.enabled) {
      this.logger.log('monitoring.writer_disabled MONITORING_ENABLED is false');
      return;
    }

    this.timer = setInterval(() => {
      void this.flush();
    }, config.monitoring.flushIntervalMs);

    // Without this the interval alone keeps the event loop alive and a process
    // that has finished its work will not exit.
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    // A deploy or restart should not silently discard what is already buffered.
    await this.flush();
  }

  recordRequest(row: Prisma.RequestLogCreateManyInput): void {
    if (!config.monitoring.enabled) return;
    this.push(this.requestBuffer, row);
  }

  recordError(row: Prisma.ErrorLogCreateManyInput): void {
    if (!config.monitoring.enabled) return;
    this.push(this.errorBuffer, row);
  }

  recordMetric(row: Prisma.SystemMetricCreateManyInput): void {
    if (!config.monitoring.enabled) return;
    this.push(this.metricBuffer, row);
  }

  /** Buffered row counts, surfaced on the admin dashboard's system panel. */
  getBufferDepth(): { requests: number; errors: number; metrics: number; dropped: number } {
    return {
      requests: this.requestBuffer.length,
      errors: this.errorBuffer.length,
      metrics: this.metricBuffer.length,
      dropped: this.droppedSinceLastReport,
    };
  }

  private push<T>(buffer: T[], row: T): void {
    buffer.push(row);

    if (buffer.length > config.monitoring.maxBufferedRows) {
      // Oldest-first: during an outage the recent rows are the ones that
      // describe what is happening now.
      const overflow = buffer.length - config.monitoring.maxBufferedRows;
      buffer.splice(0, overflow);
      this.droppedSinceLastReport += overflow;
    }

    const total = this.requestBuffer.length + this.errorBuffer.length + this.metricBuffer.length;
    if (total >= config.monitoring.flushBatchSize) void this.flush();
  }

  /**
   * Writes whatever is buffered.
   *
   * Re-entrant calls return immediately rather than queueing: the timer and a
   * full batch can fire together, and two concurrent flushes would write the
   * same rows twice.
   */
  private async flush(): Promise<void> {
    if (this.flushing) return;
    if (!this.requestBuffer.length && !this.errorBuffer.length && !this.metricBuffer.length) return;

    this.flushing = true;

    // Detached before the await so rows arriving mid-flush are not lost when
    // the buffers are cleared.
    const requests = this.requestBuffer.splice(0, this.requestBuffer.length);
    const errors = this.errorBuffer.splice(0, this.errorBuffer.length);
    const metrics = this.metricBuffer.splice(0, this.metricBuffer.length);

    try {
      await Promise.all([
        requests.length
          ? this.prisma.requestLog.createMany({ data: requests, skipDuplicates: true })
          : Promise.resolve(),
        errors.length ? this.prisma.errorLog.createMany({ data: errors, skipDuplicates: true }) : Promise.resolve(),
        metrics.length
          ? this.prisma.systemMetric.createMany({ data: metrics, skipDuplicates: true })
          : Promise.resolve(),
      ]);

      if (this.droppedSinceLastReport > 0) {
        this.logger.warn(
          `monitoring.rows_dropped ${JSON.stringify({
            dropped: this.droppedSinceLastReport,
            reason: 'buffer overflow while the database was unreachable',
          })}`,
        );
        this.droppedSinceLastReport = 0;
      }
    } catch (error) {
      // Deliberately not requeued. See the class comment.
      this.logger.error(
        `monitoring.flush_failed ${JSON.stringify({
          requests: requests.length,
          errors: errors.length,
          metrics: metrics.length,
          error: (error as Error).message,
        })}`,
      );
    } finally {
      this.flushing = false;
    }
  }
}
