import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { config } from '../../config';
import { MonitoringWriterService } from '../../monitoring/services/monitoring-writer.service';
import { SocketMetricsCollector } from '../../monitoring/services/socket-metrics.collector';
import { ListErrorsDto, ListLogsDto, TimeseriesDto, TimeWindow } from './dto/admin-monitoring.dto';

/** Minutes covered by each selectable window, and the bucket width to use for it. */
const WINDOWS: Record<TimeWindow, { minutes: number; bucketMinutes: number }> = {
  '1h': { minutes: 60, bucketMinutes: 1 },
  '24h': { minutes: 60 * 24, bucketMinutes: 30 },
  '7d': { minutes: 60 * 24 * 7, bucketMinutes: 180 },
};

@Injectable()
export class AdminMonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: MonitoringWriterService,
    private readonly sockets: SocketMetricsCollector,
  ) {}

  /**
   * Headline numbers for the dashboard's status card.
   *
   * Deliberately computed over a short trailing window rather than all time:
   * "average latency since the process started" hides a problem that began ten
   * minutes ago, which is the only kind of problem this card exists to show.
   */
  async getOverview() {
    const since = minutesAgo(5);

    const [total, errors, latency, latest] = await Promise.all([
      this.prisma.requestLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.requestLog.count({ where: { createdAt: { gte: since }, statusCode: { gte: 400 } } }),
      this.prisma.requestLog.aggregate({
        where: { createdAt: { gte: since } },
        _avg: { durationMs: true },
      }),
      this.prisma.systemMetric.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);

    const errorRate = total > 0 ? (errors / total) * 100 : 0;
    const avgLatencyMs = Math.round(latency._avg.durationMs ?? 0);

    return {
      windowMinutes: 5,
      requests: total,
      errors,
      errorRatePercent: round(errorRate),
      // Requests per second over the window, not a point sample.
      requestsPerSecond: round(total / (5 * 60)),
      avgLatencyMs,
      // Derived from the same thresholds the dashboard is told about, so the
      // server and the client can never disagree about what "degraded" means.
      health: this.deriveHealth(errorRate, avgLatencyMs),
      thresholds: {
        errorRateWarningPercent: config.monitoring.errorRateWarningPercent,
        latencyWarningMs: config.monitoring.latencyWarningMs,
      },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        // Free-text label only. Never used for a decision, so it cannot become
        // an environment branch by the back door.
        environmentLabel: config.monitoring.environmentLabel || null,
        collectionEnabled: config.monitoring.enabled,
      },
      socketConnections: this.sockets.getConnectionCount(),
      lastSnapshotAt: latest?.createdAt ?? null,
      buffer: this.writer.getBufferDepth(),
      pollingIntervalMs: config.monitoring.pollingIntervalMs,
    };
  }

  private deriveHealth(errorRatePercent: number, avgLatencyMs: number): 'healthy' | 'degraded' {
    if (errorRatePercent > config.monitoring.errorRateWarningPercent) return 'degraded';
    if (avgLatencyMs > config.monitoring.latencyWarningMs) return 'degraded';
    return 'healthy';
  }

  /**
   * Bucketed time series for the charts.
   *
   * Aggregated in Postgres with `date_bin` rather than by reading rows into
   * Node: a 7-day window can cover hundreds of thousands of rows, and shipping
   * those to the API process to reduce them there would make the monitoring
   * page the heaviest query in the application.
   */
  async getTimeseries(query: TimeseriesDto) {
    const { minutes, bucketMinutes } = WINDOWS[query.window ?? '24h'];
    const since = minutesAgo(minutes);
    const interval = `${bucketMinutes} minutes`;

    if (query.metric === 'latency') {
      const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; avg_ms: number; p95_ms: number }>>`
        SELECT date_bin(${interval}::interval, "createdAt", TIMESTAMP '2000-01-01') AS bucket,
               AVG("durationMs")::float AS avg_ms,
               PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY "durationMs")::float AS p95_ms
        FROM "RequestLog"
        WHERE "createdAt" >= ${since}
        GROUP BY bucket
        ORDER BY bucket ASC`;

      return {
        metric: query.metric,
        window: query.window ?? '24h',
        bucketMinutes,
        points: rows.map((r) => ({ t: r.bucket, avgMs: round(r.avg_ms), p95Ms: round(r.p95_ms) })),
      };
    }

    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; total: bigint; errors: bigint }>>`
      SELECT date_bin(${interval}::interval, "createdAt", TIMESTAMP '2000-01-01') AS bucket,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE "statusCode" >= 400) AS errors
      FROM "RequestLog"
      WHERE "createdAt" >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC`;

    const bucketSeconds = bucketMinutes * 60;

    return {
      metric: query.metric,
      window: query.window ?? '24h',
      bucketMinutes,
      points: rows.map((r) => {
        const total = Number(r.total);
        const errors = Number(r.errors);
        return {
          t: r.bucket,
          total,
          errors,
          // Per-second rate rather than a raw count, so switching window does
          // not change the shape of the line for the same traffic.
          rps: round(total / bucketSeconds),
          errorRatePercent: total > 0 ? round((errors / total) * 100) : 0,
        };
      }),
    };
  }

  /**
   * Per-endpoint breakdown, worst first.
   *
   * p95 alongside the average because an endpoint with a good mean and a bad
   * tail is a real user-facing problem that the mean alone conceals.
   */
  async getEndpoints(window: TimeWindow = '24h') {
    const since = minutesAgo(WINDOWS[window].minutes);

    const rows = await this.prisma.$queryRaw<
      Array<{ route: string; method: string; requests: bigint; avg_ms: number; p95_ms: number; errors: bigint }>
    >`
      SELECT "route", "method",
             COUNT(*) AS requests,
             AVG("durationMs")::float AS avg_ms,
             PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY "durationMs")::float AS p95_ms,
             COUNT(*) FILTER (WHERE "statusCode" >= 400) AS errors
      FROM "RequestLog"
      WHERE "createdAt" >= ${since}
      GROUP BY "route", "method"
      ORDER BY p95_ms DESC NULLS LAST
      LIMIT 50`;

    return {
      window,
      endpoints: rows.map((r) => {
        const requests = Number(r.requests);
        const errors = Number(r.errors);
        return {
          route: r.route,
          method: r.method,
          requests,
          avgMs: round(r.avg_ms),
          p95Ms: round(r.p95_ms),
          errors,
          errorRatePercent: requests > 0 ? round((errors / requests) * 100) : 0,
        };
      }),
    };
  }

  /** Paginated request log, filterable the way an admin actually narrows down. */
  async listLogs(query: ListLogsDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = config.monitoring.pageSize;

    const where: Prisma.RequestLogWhereInput = {};
    if (query.route) where.route = { contains: query.route, mode: 'insensitive' };
    if (query.method) where.method = query.method.toUpperCase();
    if (query.requestId) where.requestId = query.requestId;

    // A status *class* is what an admin wants ("show me the 5xx"), so a bare
    // `5` widens to the range rather than matching literally.
    if (query.status) {
      const status = Number(query.status);
      if (status >= 100) where.statusCode = status;
      else if (status >= 1 && status <= 5) where.statusCode = { gte: status * 100, lt: (status + 1) * 100 };
    }

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      this.prisma.requestLog.count({ where }),
      this.prisma.requestLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async listErrors(query: ListErrorsDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = config.monitoring.pageSize;

    const where: Prisma.ErrorLogWhereInput = {};
    if (query.route) where.route = { contains: query.route, mode: 'insensitive' };

    const [total, data] = await Promise.all([
      this.prisma.errorLog.count({ where }),
      this.prisma.errorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      // The client renders a hint when traces are off, rather than leaving an
      // admin wondering why every stack is empty.
      stackTracesEnabled: config.monitoring.logStackTraces,
    };
  }

  /** Latest snapshot plus recent history for the resource gauges. */
  async getSystem(window: TimeWindow = '1h') {
    const since = minutesAgo(WINDOWS[window].minutes);

    const [latest, history] = await Promise.all([
      this.prisma.systemMetric.findFirst({ orderBy: { createdAt: 'desc' } }),
      this.prisma.systemMetric.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        // Enough to draw a line without shipping a week of 15-second samples.
        take: 500,
      }),
    ]);

    return {
      window,
      latest,
      history,
      live: {
        // Read at request time, so the gauges are current even between
        // snapshots.
        socketConnections: this.sockets.getConnectionCount(),
        dbPool: this.prisma.getPoolStats(),
        uptimeSeconds: Math.round(process.uptime()),
        buffer: this.writer.getBufferDepth(),
      },
      collectionIntervalMs: config.monitoring.metricsIntervalMs,
    };
  }
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function round(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
