import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AFFINITY_BATCH_SIZE,
  AFFINITY_HALF_LIFE_DAYS,
  AFFINITY_TOP_N,
  AFFINITY_WINDOW_DAYS,
} from './ranking.constants';

/** Interaction weights. A comment or a DM is a conversation; a like is a tap. */
export const AFFINITY_WEIGHTS = {
  like: 1,
  bookmark: 2,
  comment: 3,
  message: 0.5,
} as const;

export interface AffinityRunResult {
  users: number;
  batches: number;
}

/**
 * Stage-2 personalisation: how much each user interacts with each other user,
 * precomputed so the For You feed reads it with one indexed join instead of
 * aggregating interaction history on every request.
 *
 *   raw(u, t)   = Σ weight × 0.5^(age_days / half_life)   over u's interactions with t
 *   score(u, t) = ln(1 + raw) / max over t' of ln(1 + raw(u, t'))
 *
 * Normalised per user to 0..1, so a heavy user and a light one feed the same
 * range into the ranking: "the person you interact with most" is 1 for both.
 * The log stops one marathon chat from making everyone else look like a
 * stranger.
 *
 * Only users seen in the window are recomputed. Rows of anyone not refreshed
 * by a run are dropped at its end, so the table never holds stale pairs.
 */
@Injectable()
export class AffinityService {
  private readonly logger = new Logger(AffinityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async rebuildAll(now: Date = new Date()): Promise<AffinityRunResult> {
    const since = new Date(
      now.getTime() - AFFINITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    let cursor = '';
    let users = 0;
    let batches = 0;
    for (;;) {
      const page = await this.prisma.user.findMany({
        where: {
          id: { gt: cursor },
          deletedAt: null,
          accountStatus: 'ACTIVE',
          lastSeenAt: { gte: since },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: AFFINITY_BATCH_SIZE,
      });
      if (page.length === 0) break;
      const ids = page.map((u) => u.id);
      await this.rebuildBatch(ids, since, now);
      users += ids.length;
      batches += 1;
      cursor = ids[ids.length - 1];
    }
    // Anyone not refreshed this run (inactive, deleted, suspended) loses
    // their rows. `now` is the run's start, so this run's writes are kept.
    await this.prisma.userAffinity.deleteMany({
      where: { updatedAt: { lt: now } },
    });
    this.logger.log(
      `Affinity rebuilt for ${users} users in ${batches} batches`,
    );
    return { users, batches };
  }

  /** Replaces the affinity rows of `userIds` in one transaction. */
  async rebuildBatch(userIds: string[], since: Date, now: Date): Promise<void> {
    if (userIds.length === 0) return;
    const halfLifeSeconds = AFFINITY_HALF_LIFE_DAYS * 24 * 60 * 60;
    const w = AFFINITY_WEIGHTS;
    await this.prisma.$transaction([
      this.prisma.userAffinity.deleteMany({
        where: { userId: { in: userIds } },
      }),
      this.prisma.$executeRaw`
        WITH batch AS (
          SELECT unnest(${userIds}::text[]) AS uid
        ),
        events AS (
          SELECT pl."userId" AS uid, p."authorId" AS tid,
                 ${w.like}::float AS w, pl."createdAt" AS t
          FROM "PostLike" pl
          JOIN batch b ON b.uid = pl."userId"
          JOIN "Post" p ON p.id = pl."postId"
          WHERE pl."createdAt" >= ${since}
          UNION ALL
          SELECT pb."userId", p."authorId", ${w.bookmark}::float, pb."createdAt"
          FROM "PostBookmark" pb
          JOIN batch b ON b.uid = pb."userId"
          JOIN "Post" p ON p.id = pb."postId"
          WHERE pb."createdAt" >= ${since}
          UNION ALL
          SELECT c."authorId", p."authorId", ${w.comment}::float, c."createdAt"
          FROM "Comment" c
          JOIN batch b ON b.uid = c."authorId"
          JOIN "Post" p ON p.id = c."postId"
          WHERE c."createdAt" >= ${since} AND c."deletedAt" IS NULL
          UNION ALL
          -- Messages the user sent in a one-to-one DM, credited to the other
          -- participant. Reached through the user's own DM conversations so
          -- the [conversationId, createdAt] index bounds the scan.
          SELECT m."senderId", other."userId", ${w.message}::float, m."createdAt"
          FROM batch b
          JOIN "ConversationParticipant" mine ON mine."userId" = b.uid
          JOIN "Conversation" cv ON cv.id = mine."conversationId" AND cv.type = 'DM'
          JOIN "ConversationParticipant" other
            ON other."conversationId" = cv.id AND other."userId" <> b.uid
          JOIN "Message" m
            ON m."conversationId" = cv.id AND m."senderId" = b.uid
           AND m."createdAt" >= ${since} AND m."deletedAt" IS NULL
        ),
        agg AS (
          SELECT uid, tid,
                 SUM(w * power(0.5, EXTRACT(EPOCH FROM ((${now}::timestamptz AT TIME ZONE 'UTC') - t)) / ${halfLifeSeconds})) AS raw
          FROM events
          WHERE uid <> tid
          GROUP BY uid, tid
        ),
        ranked AS (
          SELECT a.uid, a.tid, ln(1 + a.raw) AS s,
                 row_number() OVER (PARTITION BY a.uid ORDER BY a.raw DESC, a.tid) AS rn,
                 max(ln(1 + a.raw)) OVER (PARTITION BY a.uid) AS mx
          FROM agg a
          JOIN "User" tu ON tu.id = a.tid AND tu."deletedAt" IS NULL
        )
        INSERT INTO "UserAffinity" ("userId", "targetId", "score", "updatedAt")
        SELECT uid, tid, CASE WHEN mx > 0 THEN s / mx ELSE 0 END, ${now}
        FROM ranked
        WHERE rn <= ${AFFINITY_TOP_N}
      `,
    ]);
  }
}
