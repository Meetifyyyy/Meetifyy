import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { runOnOneReplica } from '../redis/run-on-one-replica';
import { traceBackground } from '../observability/background-trace';
import { errorMessage } from '../common/utils/error.util';
import { MATCH_HISTORY_RETENTION_DAYS } from './instant-match.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps Instant Match history for `MATCH_HISTORY_RETENTION_DAYS` and no
 * longer (owner decision, 2026-11-14).
 *
 * A `MatchSession` row records who was proposed to whom, how it went and,
 * since the learning plan's phase 1, what the pairing was judged on. Ended
 * chats are already deleted by the messages cleanup, so this row is the last
 * record of the pairing; deleting it is the whole of the retention.
 *
 * Only finished sessions go. A proposal still waiting for answers, or a chat
 * still open, is left to the 10-second sweep, which ends it and deletes its
 * messages — deleting the row first would leave that chat with nothing to
 * end it.
 *
 * Same shape as the other retention sweeps: at boot, then every six hours,
 * on one replica at a time, in bounded batches, never throwing.
 */
@Injectable()
export class MatchHistoryRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  /** Well under the interval; only matters if the holder dies mid-sweep. */
  private static readonly LOCK_TTL_MS = 15 * 60 * 1000;

  /** Rows per statement, so a backlog is cleared in bounded deletes. */
  private batchSize = 1_000;

  private readonly logger = new Logger(MatchHistoryRetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sweepOnOneReplica();
    this.timer = setInterval(
      () =>
        void traceBackground(
          { name: 'task instant-match.history-retention', op: 'task' },
          () => this.sweepOnOneReplica(),
        ),
      MatchHistoryRetentionService.SWEEP_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The retention cut-off, as an absolute instant. */
  get cutoff(): Date {
    return new Date(Date.now() - MATCH_HISTORY_RETENTION_DAYS * DAY_MS);
  }

  /** Finished sessions created before `cutoff`. */
  static finishedBefore(cutoff: Date): Prisma.MatchSessionWhereInput {
    return {
      createdAt: { lt: cutoff },
      OR: [
        { status: { in: ['DECLINED', 'EXPIRED'] } },
        { status: 'ACCEPTED', chatStatus: { not: 'ACTIVE' } },
      ],
    };
  }

  private async sweepOnOneReplica(): Promise<void> {
    await runOnOneReplica(
      this.redis,
      'instant-match:history-retention',
      MatchHistoryRetentionService.LOCK_TTL_MS,
      () => this.sweep(),
    );
  }

  /** One pass. Idempotent, and never throws — it runs from a timer. */
  async sweep(): Promise<number> {
    const finished = MatchHistoryRetentionService.finishedBefore(this.cutoff);
    let removed = 0;
    try {
      for (;;) {
        const stale = await this.prisma.matchSession.findMany({
          where: finished,
          select: { id: true },
          take: this.batchSize,
        });
        if (stale.length === 0) break;

        // The condition is applied again, so a row read here is deleted only
        // if it is still finished and still old.
        const { count } = await this.prisma.matchSession.deleteMany({
          where: {
            AND: [{ id: { in: stale.map((row) => row.id) } }, finished],
          },
        });
        removed += count;

        if (stale.length < this.batchSize) break;
      }
      if (removed > 0) {
        this.logger.log(
          `match-history:pruned removed=${removed} olderThanDays=${MATCH_HISTORY_RETENTION_DAYS}`,
        );
      }
    } catch (err) {
      this.logger.warn(`match-history:prune-failed error=${errorMessage(err)}`);
    }
    return removed;
  }
}
