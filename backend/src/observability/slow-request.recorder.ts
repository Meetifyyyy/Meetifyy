import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

export interface SlowRequestRecord {
  route: string;
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
  requestId: string | null;
  userId: string | null;
  adminId: string | null;
  ip: string | null;
  userAgent: string | null;
  bytesOut: number | null;
}

/**
 * Buffers slow-request rows and writes them off the request path.
 *
 * Two properties matter more than completeness here:
 *
 *  - Recording must never slow a request down. Callers hand the row over and
 *    return; the insert happens on a timer, in one batch.
 *  - Recording must never be the cause of an outage. The buffer is capped, the
 *    write rate is capped, and a failed insert is logged and dropped rather
 *    than retried forever. Losing a diagnostic row is always preferable to
 *    adding load to a database that is already struggling.
 */
@Injectable()
export class SlowRequestRecorder implements OnModuleDestroy {
  private readonly logger = new Logger(SlowRequestRecorder.name);
  private readonly flushIntervalMs = 5_000;

  private buffer: SlowRequestRecord[] = [];
  private droppedSinceLastFlush = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (!config.observability.slowRequests.enabled) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // Never hold the process open on this timer alone.
    this.timer.unref?.();
  }

  record(record: SlowRequestRecord): void {
    const { maxPerMinute } = config.observability.slowRequests;
    // The cap is expressed per minute; the buffer drains every 5s.
    const perFlushCeiling = Math.max(1, Math.ceil(maxPerMinute / 12));

    if (this.buffer.length >= perFlushCeiling) {
      this.droppedSinceLastFlush += 1;
      return;
    }
    this.buffer.push(record);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      this.reportDrops();
      return;
    }

    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.prisma.slowRequest.createMany({ data: batch });
    } catch (error) {
      // Deliberately not re-queued: if the database is the reason requests are
      // slow, retrying these inserts makes the incident worse.
      this.logger.warn(
        `slow-request:flush-failed dropped=${batch.length} error=${
          (error as Error).message
        }`,
      );
    }

    this.reportDrops();
  }

  private reportDrops(): void {
    if (this.droppedSinceLastFlush === 0) return;
    // The count is worth knowing — it means the app was slow enough to exceed
    // the write budget, which is itself a signal.
    this.logger.warn(
      `slow-request:rate-capped dropped=${this.droppedSinceLastFlush}`,
    );
    this.droppedSinceLastFlush = 0;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
