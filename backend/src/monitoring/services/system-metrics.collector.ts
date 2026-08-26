import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';
import { MonitoringWriterService } from './monitoring-writer.service';
import { SocketMetricsCollector } from './socket-metrics.collector';

/**
 * Takes a periodic snapshot of process and database health.
 *
 * Everything here comes from Node, `pg` and Socket.IO primitives. Nothing reads
 * a hosting provider's API, so this keeps working unchanged if the app moves
 * host - which is the point of building it rather than screen-scraping the
 * platform dashboard.
 *
 * The interval is a plain `setInterval`, matching how the rest of this codebase
 * schedules recurring work, so the feature adds no scheduler dependency.
 */
@Injectable()
export class SystemMetricsCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemMetricsCollector.name);

  private timer: NodeJS.Timeout | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuSampleAt = process.hrtime.bigint();

  /** Rolling event-loop lag, refreshed between snapshots. */
  private lagTimer: NodeJS.Timeout | null = null;
  private currentLagMs = 0;

  constructor(
    private readonly writer: MonitoringWriterService,
    private readonly prisma: PrismaService,
    private readonly sockets: SocketMetricsCollector,
  ) {}

  onModuleInit(): void {
    if (!config.monitoring.enabled) return;

    this.startLagProbe();

    this.timer = setInterval(() => this.collect(), config.monitoring.metricsIntervalMs);
    this.timer.unref?.();

    this.logger.log(
      `monitoring.metrics_started ${JSON.stringify({ intervalMs: config.monitoring.metricsIntervalMs })}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.lagTimer) clearInterval(this.lagTimer);
  }

  /**
   * Measures how late a timer scheduled for "as soon as possible" actually
   * fires. That delay is the event loop being blocked, which is the symptom a
   * CPU percentage alone will not show: a process pinned by synchronous work
   * looks busy either way, but only lag says requests are queueing behind it.
   */
  private startLagProbe(): void {
    const probeIntervalMs = 500;
    let expected = process.hrtime.bigint() + BigInt(probeIntervalMs * 1_000_000);

    this.lagTimer = setInterval(() => {
      const now = process.hrtime.bigint();
      const lag = Number(now - expected) / 1_000_000;
      // Smoothed so one unlucky tick does not dominate the snapshot.
      this.currentLagMs = Math.max(0, this.currentLagMs * 0.5 + Math.max(0, lag) * 0.5);
      expected = now + BigInt(probeIntervalMs * 1_000_000);
    }, probeIntervalMs);

    this.lagTimer.unref?.();
  }

  private collect(): void {
    try {
      const memory = process.memoryUsage();
      const pool = this.prisma.getPoolStats();

      this.writer.recordMetric({
        memoryRssMb: round(memory.rss / 1024 / 1024),
        memoryHeapUsedMb: round(memory.heapUsed / 1024 / 1024),
        cpuPercent: this.cpuPercentSinceLastSample(),
        eventLoopLagMs: round(this.currentLagMs),
        dbPoolActive: pool.active,
        dbPoolIdle: pool.idle,
        dbPoolWaiting: pool.waiting,
        socketConnections: this.sockets.getConnectionCount(),
      });
    } catch (error) {
      // A failed snapshot must never interrupt the interval or the app.
      this.logger.warn(`monitoring.metrics_collection_failed ${JSON.stringify({ error: (error as Error).message })}`);
    }
  }

  /**
   * CPU used by this process since the previous snapshot, as a percentage of
   * one core. Computed from deltas because `process.cpuUsage()` is cumulative
   * since start - reading it absolutely would report an average over the
   * process lifetime rather than what is happening now.
   */
  private cpuPercentSinceLastSample(): number {
    const usage = process.cpuUsage(this.lastCpuUsage);
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - this.lastCpuSampleAt) / 1000;

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = now;

    if (elapsedMicros <= 0) return 0;
    return round(((usage.user + usage.system) / elapsedMicros) * 100);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
