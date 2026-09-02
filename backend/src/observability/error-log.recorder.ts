import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

export type ErrorSeverity = 'UNEXPECTED' | 'EXPECTED';

export interface ErrorLogRecord {
  route: string;
  path: string;
  method: string;
  statusCode: number;
  severity: ErrorSeverity;
  message: string;
  name: string | null;
  stack: string | null;
  requestId: string | null;
  userId: string | null;
  adminId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** Column widths from the ErrorLog model. Truncating here keeps the insert from
 *  failing on a long Prisma message, which would lose the row entirely. */
const LIMITS = {
  route: 300,
  path: 500,
  method: 10,
  message: 1000,
  name: 120,
  stack: 4000,
  requestId: 100,
  userId: 64,
  adminId: 64,
  ip: 64,
  userAgent: 300,
} as const;

const clip = (value: string | null | undefined, max: number): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
};

/**
 * Buffers error rows and writes them off the request path.
 *
 * Deliberately the same shape as SlowRequestRecorder, and for a sharper reason:
 * the thing being recorded is a failure, and failures arrive in bursts. If the
 * database is what broke, one insert per failing request would aim the incident
 * straight back at the database. So the buffer is capped, the write rate is
 * capped, a failed insert is dropped rather than retried, and nothing here is
 * ever awaited by a request.
 */
@Injectable()
export class ErrorLogRecorder implements OnModuleDestroy {
  private readonly logger = new Logger(ErrorLogRecorder.name);
  private readonly flushIntervalMs = 5_000;

  private buffer: ErrorLogRecord[] = [];
  private droppedSinceLastFlush = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (!config.observability.errorLogs.enabled) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // Never hold the process open on this timer alone.
    this.timer.unref?.();
  }

  /** True when this path is one the capture deliberately ignores. */
  private ignored(path: string): boolean {
    return config.observability.errorLogs.ignoredPrefixes.some((prefix) =>
      path.startsWith(prefix),
    );
  }

  record(record: ErrorLogRecord): void {
    const { enabled, maxPerMinute, captureClientErrors } =
      config.observability.errorLogs;
    if (!enabled) return;
    if (record.statusCode < 500 && !captureClientErrors) return;
    if (this.ignored(record.path)) return;

    // The cap is per minute; the buffer drains every 5s.
    const perFlushCeiling = Math.max(1, Math.ceil(maxPerMinute / 12));
    if (this.buffer.length >= perFlushCeiling) {
      this.droppedSinceLastFlush += 1;
      return;
    }

    this.buffer.push({
      ...record,
      route: clip(record.route, LIMITS.route) ?? record.path,
      path: clip(record.path, LIMITS.path) ?? '',
      method: clip(record.method, LIMITS.method) ?? '',
      message: clip(record.message, LIMITS.message) ?? '',
      name: clip(record.name, LIMITS.name),
      stack: clip(record.stack, LIMITS.stack),
      requestId: clip(record.requestId, LIMITS.requestId),
      userId: clip(record.userId, LIMITS.userId),
      adminId: clip(record.adminId, LIMITS.adminId),
      ip: clip(record.ip, LIMITS.ip),
      userAgent: clip(record.userAgent, LIMITS.userAgent),
    });
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      this.reportDrops();
      return;
    }

    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.prisma.errorLog.createMany({ data: batch });
    } catch (error) {
      // Not re-queued. If the database is the reason these errors exist,
      // retrying the inserts makes the incident worse.
      this.logger.warn(
        `error-log:flush-failed dropped=${batch.length} error=${
          (error as Error).message
        }`,
      );
    }

    this.reportDrops();
  }

  private reportDrops(): void {
    if (this.droppedSinceLastFlush === 0) return;
    // Worth knowing: it means errors arrived faster than the write budget,
    // which is itself the signal.
    this.logger.warn(`error-log:rate-capped dropped=${this.droppedSinceLastFlush}`);
    this.droppedSinceLastFlush = 0;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
