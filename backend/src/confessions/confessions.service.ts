import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { ConfessionStatus, Prisma, ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { CONFESSION_REACTIONS_EVENT } from './confession-events';
import { errorMessage } from '../common/utils/error.util';
import { parseKeysetCursor } from '../common/pagination.util';
import {
  CONFESSION_AUTO_HIDE_REPORTERS,
  DUPLICATE_WINDOW_MS,
  checkHandle,
  confessionHash,
  confessionLengthOk,
  handleKey,
  normaliseConfession,
} from './confession-rules';
import {
  type ConfessionReactionKey,
  type ReactionCounts,
  emptyReactionCounts,
  reactionKeyFromText,
  reactionKeyOf,
  reactionTypeOf,
  totalReactions,
} from './confession-reactions';

/**
 * What a client sees of a confession. Deliberately carries no user id, profile
 * id, name, username, avatar or email: the handle is the only identity.
 */
export interface ConfessionDto extends ReactionState {
  id: string;
  handle: string;
  content: string;
  createdAt: string;
  isMine: boolean;
}

export interface ConfessionProfileDto {
  handle: string;
  createdAt: string;
}

export interface HandleAvailability {
  handle: string;
  available: boolean;
  reason: null | 'invalid' | 'reserved' | 'taken';
}

export interface ConfessionPage {
  confessions: ConfessionDto[];
  nextCursor: string | null;
}

/**
 * A confession's reactions as the caller sees them: totals per kind and their
 * own choice. Never who else reacted.
 *
 * `relateCount` and `relatedByMe` are what installed builds from before
 * reactions read (they only knew Relate): the total, and whether the caller
 * has reacted at all. They must stay until no such build is supported.
 */
export interface ReactionState {
  reactions: ReactionCounts;
  reactionCount: number;
  myReaction: ConfessionReactionKey | null;
  relateCount: number;
  relatedByMe: boolean;
}

/**
 * What changed since the feed was loaded, in one answer: confessions newer
 * than the newest it holds, fresh totals for the ones it shows, and which of
 * those are gone (deleted, hidden, removed, or no longer on this campus).
 */
export interface ConfessionSync {
  newer: ConfessionDto[];
  /** More newer than fit: the client starts the feed again instead. */
  hasMoreNewer: boolean;
  states: Record<string, ReactionState>;
  gone: string[];
}

/** Most new confessions a sync returns before telling the client to reload. */
const SYNC_MAX_NEWER = 50;

/** What the legacy relate routes answer: the same state. */
export type RelateState = ReactionState;

/** The single row a reaction statement answers with (see reactionStatement). */
interface ReactionRow extends ReactionCounts {
  hasProfile: boolean;
  visible: boolean;
  /** The caller's reaction before this change, as the enum's text. */
  previous: string | null;
}

const CONFESSION_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  profileId: true,
  profile: { select: { handle: true } },
} satisfies Prisma.ConfessionSelect;

type ConfessionRow = Prisma.ConfessionGetPayload<{
  select: typeof CONFESSION_SELECT;
}>;

const PROFILE_REQUIRED = {
  statusCode: 403,
  code: 'confession_profile_required',
  message: 'Choose a confession handle first.',
};

/**
 * First key of the two-key advisory lock that serialises one profile's
 * posting; the second is a hash of the profile id. Distinct from the
 * single-key locks used elsewhere (admin-legal), which live in another space.
 */
const CONFESSION_LOCK_NAMESPACE = 0x0c0f;

/** Reports a moderator has not ruled on yet. */
const OPEN_REPORT_STATUSES: ReportStatus[] = [
  ReportStatus.PENDING,
  ReportStatus.UNDER_REVIEW,
];

function notFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'confession_not_found',
    message: 'Confession not found.',
  });
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** Unique-constraint target names, as Prisma reports them. */
function uniqueTarget(err: unknown): string[] {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return [];
  const target: unknown = err.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((t): t is string => typeof t === 'string');
  }
  return typeof target === 'string' ? [target] : [];
}

/**
 * Anonymous confessions, scoped to the caller's campus. Every method takes the
 * `collegeId` the controller resolved from the caller's ACTIVE affiliation;
 * nothing here accepts a campus from the request.
 */
@Injectable()
export class ConfessionsService {
  private readonly logger = new Logger(ConfessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Live reaction totals to the campus's confessions room. Optional so a
    // test can build the service without it; nothing is broadcast then.
    @Optional() private readonly events?: DomainEventService,
  ) {}

  async getMyProfile(
    userId: string,
  ): Promise<{ profile: ConfessionProfileDto | null }> {
    const profile = await this.prisma.confessionProfile.findUnique({
      where: { userId },
      select: { handle: true, createdAt: true },
    });
    return {
      profile: profile
        ? { handle: profile.handle, createdAt: profile.createdAt.toISOString() }
        : null,
    };
  }

  private async ownUsername(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? null;
  }

  async checkAvailability(
    userId: string,
    rawHandle: string | undefined,
  ): Promise<HandleAvailability> {
    const handle = (rawHandle ?? '').trim();
    const problem = checkHandle(handle, await this.ownUsername(userId));
    if (problem) return { handle, available: false, reason: problem };
    const existing = await this.prisma.confessionProfile.findUnique({
      where: { handleKey: handleKey(handle) },
      select: { id: true },
    });
    return existing
      ? { handle, available: false, reason: 'taken' }
      : { handle, available: true, reason: null };
  }

  async createProfile(
    userId: string,
    rawHandle: string,
  ): Promise<{ profile: ConfessionProfileDto }> {
    const handle = rawHandle.trim();
    const problem = checkHandle(handle, await this.ownUsername(userId));
    if (problem) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'handle_invalid',
        reason: problem,
        message:
          problem === 'reserved'
            ? 'That handle is reserved.'
            : 'Handles are 3-20 letters, numbers, dots or underscores, starting with a letter.',
      });
    }

    const existing = await this.prisma.confessionProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) throw this.profileExists();

    try {
      const created = await this.prisma.confessionProfile.create({
        data: { userId, handle, handleKey: handleKey(handle) },
        select: { handle: true, createdAt: true },
      });
      return {
        profile: {
          handle: created.handle,
          createdAt: created.createdAt.toISOString(),
        },
      };
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        // Two concurrent creates by the same user collide on userId; anyone
        // else's collide on handleKey.
        if (uniqueTarget(err).some((t) => t.includes('userId'))) {
          throw this.profileExists();
        }
        throw new ConflictException({
          statusCode: 409,
          code: 'handle_taken',
          message: 'That handle is already taken.',
        });
      }
      throw err;
    }
  }

  private profileExists(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'profile_exists',
      message: 'You already have a confession handle.',
    });
  }

  private async profileIdOf(userId: string): Promise<string | null> {
    const profile = await this.prisma.confessionProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  private async requireProfileId(userId: string): Promise<string> {
    const id = await this.profileIdOf(userId);
    if (!id) throw new ForbiddenException(PROFILE_REQUIRED);
    return id;
  }

  private toDto(
    row: ConfessionRow,
    myProfileId: string | null,
    state: ReactionState,
  ): ConfessionDto {
    return {
      id: row.id,
      handle: row.profile.handle,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      isMine: myProfileId !== null && row.profileId === myProfileId,
      ...state,
    };
  }

  /**
   * Per-kind counts for each of `ids`, in one grouped read. Counted from the
   * reaction rows rather than a stored counter, so the split between kinds is
   * always exact; a confession nobody reacted to gets all zeros.
   */
  private async countReactions(
    db: Prisma.TransactionClient | PrismaService,
    ids: string[],
  ): Promise<Map<string, ReactionCounts>> {
    const out = new Map<string, ReactionCounts>();
    for (const id of ids) out.set(id, emptyReactionCounts());
    if (ids.length === 0) return out;
    const groups = await db.confessionReaction.groupBy({
      by: ['confessionId', 'reaction'],
      where: { confessionId: { in: ids } },
      _count: { _all: true },
    });
    for (const g of groups) {
      const counts = out.get(g.confessionId);
      if (counts) counts[reactionKeyOf(g.reaction)] = g._count._all;
    }
    return out;
  }

  /** The caller's own reaction to each of `ids` that they reacted to. */
  private async myReactions(
    db: Prisma.TransactionClient | PrismaService,
    profileId: string | null,
    ids: string[],
  ): Promise<Map<string, ConfessionReactionKey>> {
    const out = new Map<string, ConfessionReactionKey>();
    if (!profileId || ids.length === 0) return out;
    const rows = await db.confessionReaction.findMany({
      where: { profileId, confessionId: { in: ids } },
      select: { confessionId: true, reaction: true },
    });
    for (const r of rows) out.set(r.confessionId, reactionKeyOf(r.reaction));
    return out;
  }

  private static stateOf(
    counts: ReactionCounts,
    mine: ConfessionReactionKey | null,
  ): ReactionState {
    const total = totalReactions(counts);
    return {
      reactions: counts,
      reactionCount: total,
      myReaction: mine,
      relateCount: total,
      relatedByMe: mine !== null,
    };
  }

  /** DTOs for rows already known to be visible to the caller. */
  private async present(
    rows: ConfessionRow[],
    myProfileId: string | null,
  ): Promise<ConfessionDto[]> {
    const ids = rows.map((r) => r.id);
    const [counts, mine] = await Promise.all([
      this.countReactions(this.prisma, ids),
      this.myReactions(this.prisma, myProfileId, ids),
    ]);
    return rows.map((r) =>
      this.toDto(
        r,
        myProfileId,
        ConfessionsService.stateOf(
          counts.get(r.id) ?? emptyReactionCounts(),
          mine.get(r.id) ?? null,
        ),
      ),
    );
  }

  async list(
    userId: string,
    collegeId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<ConfessionPage> {
    const myProfileId = await this.profileIdOf(userId);
    const cursor = parseKeysetCursor(opts.cursor);
    const where: Prisma.ConfessionWhereInput = {
      collegeId,
      status: ConfessionStatus.VISIBLE,
    };
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.date } },
        { createdAt: cursor.date, id: { lt: cursor.id } },
      ];
    }
    const rows = await this.prisma.confession.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      select: CONFESSION_SELECT,
    });
    const page = rows.slice(0, opts.limit);
    const hasMore = rows.length > opts.limit;

    const last = page[page.length - 1];
    return {
      confessions: await this.present(page, myProfileId),
      nextCursor:
        hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    };
  }

  async create(
    userId: string,
    collegeId: string,
    rawContent: string,
  ): Promise<{ confession: ConfessionDto }> {
    const content = normaliseConfession(rawContent);
    if (!confessionLengthOk(content)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'content_invalid',
        message: 'Confessions are 15 to 1000 characters.',
      });
    }
    const profileId = await this.requireProfileId(userId);
    const contentHash = confessionHash(content);

    // The duplicate check and the insert are one step per profile. Checked
    // and inserted separately, a double tap (or a retry racing its original)
    // passed the check twice and posted the same confession twice. The lock
    // is the transaction's, so it is released however the transaction ends.
    //
    // This, not an Idempotency-Key, is what makes posting safe to retry: the
    // idempotency cache would keep the caller's account id beside the
    // confession it created, which is exactly the link anonymity forbids.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CONFESSION_LOCK_NAMESPACE}::int4, hashtext(${profileId}))`;
      const duplicate = await tx.confession.findFirst({
        where: {
          profileId,
          contentHash,
          createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({
          statusCode: 409,
          code: 'duplicate_confession',
          message: 'You already posted this confession.',
        });
      }
      return tx.confession.create({
        data: { collegeId, profileId, content, contentHash },
        select: CONFESSION_SELECT,
      });
    });
    return {
      confession: this.toDto(
        row,
        profileId,
        ConfessionsService.stateOf(emptyReactionCounts(), null),
      ),
    };
  }

  /**
   * One confession, for a link or a card shared in a chat. The same rule as
   * the feed: VISIBLE and on the caller's own campus, or 404 — a hidden,
   * removed, deleted or other-campus confession is indistinguishable from one
   * that never existed, so a stale share reveals nothing.
   */
  async get(
    userId: string,
    collegeId: string,
    confessionId: string,
  ): Promise<{ confession: ConfessionDto }> {
    const [row, myProfileId] = await Promise.all([
      this.prisma.confession.findFirst({
        where: {
          id: confessionId,
          collegeId,
          status: ConfessionStatus.VISIBLE,
        },
        select: CONFESSION_SELECT,
      }),
      this.profileIdOf(userId),
    ]);
    if (!row) throw notFound();
    const [confession] = await this.present([row], myProfileId);
    return { confession };
  }

  /**
   * The feed's catch-up, for reopening the page: instead of downloading every
   * loaded page again, one request asks for what is newer than the top of the
   * feed and the current totals of what it already shows. Four reads, the
   * independent ones in parallel; the counts for new and old in one group-by.
   */
  async sync(
    userId: string,
    collegeId: string,
    input: { after?: string; ids: string[] },
  ): Promise<ConfessionSync> {
    const ids = [...new Set(input.ids)];
    const cursor = parseKeysetCursor(input.after);
    const scope: Prisma.ConfessionWhereInput = {
      collegeId,
      status: ConfessionStatus.VISIBLE,
    };
    const [myProfileId, newerRows, stillVisible] = await Promise.all([
      this.profileIdOf(userId),
      cursor
        ? this.prisma.confession.findMany({
            where: {
              ...scope,
              OR: [
                { createdAt: { gt: cursor.date } },
                { createdAt: cursor.date, id: { gt: cursor.id } },
              ],
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: SYNC_MAX_NEWER + 1,
            select: CONFESSION_SELECT,
          })
        : Promise.resolve([] as ConfessionRow[]),
      ids.length > 0
        ? this.prisma.confession.findMany({
            where: { ...scope, id: { in: ids } },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
    ]);

    const newer = newerRows.slice(0, SYNC_MAX_NEWER);
    const visibleIds = stillVisible.map((r) => r.id);
    const countIds = [...new Set([...newer.map((r) => r.id), ...visibleIds])];
    const [counts, mine] = await Promise.all([
      this.countReactions(this.prisma, countIds),
      this.myReactions(this.prisma, myProfileId, countIds),
    ]);
    const stateFor = (id: string) =>
      ConfessionsService.stateOf(
        counts.get(id) ?? emptyReactionCounts(),
        mine.get(id) ?? null,
      );

    const visible = new Set(visibleIds);
    const states: Record<string, ReactionState> = {};
    for (const id of visibleIds) states[id] = stateFor(id);
    return {
      newer: newer.map((r) => this.toDto(r, myProfileId, stateFor(r.id))),
      hasMoreNewer: newerRows.length > SYNC_MAX_NEWER,
      states,
      gone: ids.filter((id) => !visible.has(id)),
    };
  }

  /**
   * Sets the caller's reaction, replacing any other they had. One row per
   * profile per confession (the primary key), so a repeat is a change, never
   * a second reaction, and `relateCount` moves only when a row is added.
   */
  async react(
    userId: string,
    collegeId: string,
    confessionId: string,
    key: ConfessionReactionKey,
  ): Promise<ReactionState> {
    const reaction = reactionTypeOf(key);
    const row = await this.reactionStatement(
      userId,
      collegeId,
      confessionId,
      Prisma.sql`
        written AS (
          INSERT INTO "ConfessionRelate" ("confessionId", "profileId", "reaction")
          SELECT target.id, me.id, ${reaction}::"ConfessionReactionType"
          FROM target, me
          ON CONFLICT ("confessionId", "profileId") DO UPDATE
            SET "reaction" = EXCLUDED."reaction"
            WHERE "ConfessionRelate"."reaction" IS DISTINCT FROM EXCLUDED."reaction"
          RETURNING (xmax = 0) AS added
        ),
        counted AS (
          UPDATE "Confession" SET "relateCount" = "relateCount" + 1
          WHERE id IN (SELECT id FROM target)
            AND EXISTS (SELECT 1 FROM written WHERE added)
          RETURNING id
        )`,
      Prisma.sql`(SELECT r.reaction::text FROM mine r)`,
    );
    return this.settle(collegeId, confessionId, row, key);
  }

  /** Takes the caller's reaction back, whichever kind it was. */
  async unreact(
    userId: string,
    collegeId: string,
    confessionId: string,
  ): Promise<ReactionState> {
    const row = await this.reactionStatement(
      userId,
      collegeId,
      confessionId,
      Prisma.sql`
        written AS (
          DELETE FROM "ConfessionRelate" r
          USING target, me
          WHERE r."confessionId" = target.id AND r."profileId" = me.id
          RETURNING r.reaction
        ),
        counted AS (
          UPDATE "Confession" SET "relateCount" = GREATEST("relateCount" - 1, 0)
          WHERE id IN (SELECT id FROM target)
            AND EXISTS (SELECT 1 FROM written)
          RETURNING id
        )`,
      // What was actually removed, rather than what the snapshot saw.
      Prisma.sql`(SELECT w.reaction::text FROM written w)`,
    );
    return this.settle(collegeId, confessionId, row, null);
  }

  /**
   * The legacy Relate from builds that predate reactions. Adds RELATABLE when
   * the caller has no reaction; one they already chose in a newer build is
   * left alone rather than overwritten by an app that cannot show it.
   */
  async relate(
    userId: string,
    collegeId: string,
    confessionId: string,
  ): Promise<RelateState> {
    const row = await this.reactionStatement(
      userId,
      collegeId,
      confessionId,
      Prisma.sql`
        written AS (
          INSERT INTO "ConfessionRelate" ("confessionId", "profileId", "reaction")
          SELECT target.id, me.id, 'RELATABLE'::"ConfessionReactionType"
          FROM target, me
          ON CONFLICT ("confessionId", "profileId") DO NOTHING
          RETURNING true AS added
        ),
        counted AS (
          UPDATE "Confession" SET "relateCount" = "relateCount" + 1
          WHERE id IN (SELECT id FROM target)
            AND EXISTS (SELECT 1 FROM written)
          RETURNING id
        )`,
      Prisma.sql`(SELECT r.reaction::text FROM mine r)`,
    );
    // Kept: whatever they already had. Added: Relatable.
    return this.settle(
      collegeId,
      confessionId,
      row,
      row.previous === null
        ? 'relatable'
        : (reactionKeyFromText(row.previous) ?? 'relatable'),
    );
  }

  /** The legacy un-relate: removes the caller's reaction, of any kind. */
  async unrelate(
    userId: string,
    collegeId: string,
    confessionId: string,
  ): Promise<RelateState> {
    return this.unreact(userId, collegeId, confessionId);
  }

  /**
   * One reaction change as ONE statement, so a burst of taps costs one round
   * trip each and holds no transaction open between them: the caller's
   * profile, the visibility check (VISIBLE, this campus), the write (`written`),
   * the stored total (`counted`), the caller's previous reaction and the
   * per-kind counts. The write and the total commit together because they are
   * one statement.
   *
   * Every CTE reads the snapshot from before the statement, so the counts and
   * `previous` are the state the write was applied to; `after` adds the write.
   * Nothing is written without a profile or a visible confession, because the
   * write selects FROM `target, me` and either may be empty.
   */
  private async reactionStatement(
    userId: string,
    collegeId: string,
    confessionId: string,
    write: Prisma.Sql,
    previous: Prisma.Sql,
  ): Promise<ReactionRow> {
    const rows = await this.prisma.$queryRaw<ReactionRow[]>`
      WITH me AS (
        SELECT id FROM "ConfessionProfile" WHERE "userId" = ${userId}
      ),
      target AS (
        SELECT id FROM "Confession"
        WHERE id = ${confessionId}
          AND "collegeId" = ${collegeId}
          AND status = 'VISIBLE'
      ),
      mine AS (
        SELECT r.reaction FROM "ConfessionRelate" r, me
        WHERE r."confessionId" = ${confessionId} AND r."profileId" = me.id
      ),
      ${write}
      SELECT
        EXISTS (SELECT 1 FROM me) AS "hasProfile",
        EXISTS (SELECT 1 FROM target) AS "visible",
        ${previous} AS "previous",
        count(*) FILTER (WHERE c.reaction = 'LOVE')::int AS "love",
        count(*) FILTER (WHERE c.reaction = 'FUNNY')::int AS "funny",
        count(*) FILTER (WHERE c.reaction = 'SAD')::int AS "sad",
        count(*) FILTER (WHERE c.reaction = 'SURPRISED')::int AS "surprised",
        count(*) FILTER (WHERE c.reaction = 'RELATABLE')::int AS "relatable"
      FROM "ConfessionRelate" c
      WHERE c."confessionId" = ${confessionId}
    `;
    const row = rows[0];
    // Same order as before: no profile is 403 wherever the confession is.
    if (!row?.hasProfile) throw new ForbiddenException(PROFILE_REQUIRED);
    if (!row.visible) throw notFound();
    return row;
  }

  /**
   * The caller's answer, and, when the totals actually moved, the same totals
   * to everyone on the campus with the page open. A repeat or a no-op sends
   * nothing. Only totals travel: never who reacted or what the caller chose.
   * Fire-and-forget: a failed broadcast must not fail the reaction.
   */
  private settle(
    collegeId: string,
    confessionId: string,
    row: ReactionRow,
    mine: ConfessionReactionKey | null,
  ): ReactionState {
    const state = ConfessionsService.after(row, mine);
    const previous =
      row.previous === null ? null : reactionKeyFromText(row.previous);
    if (this.events && previous !== mine) {
      this.events
        .emit(CONFESSION_REACTIONS_EVENT, {
          collegeId,
          confessionId,
          reactions: state.reactions,
          reactionCount: state.reactionCount,
          at: Date.now(),
        })
        .catch((err: unknown) =>
          this.logger.warn(`Reaction broadcast failed: ${errorMessage(err)}`),
        );
    }
    return state;
  }

  /** The counts once the caller's reaction is `mine` instead of `previous`. */
  private static after(
    row: ReactionRow,
    mine: ConfessionReactionKey | null,
  ): ReactionState {
    const counts: ReactionCounts = {
      love: row.love,
      funny: row.funny,
      sad: row.sad,
      surprised: row.surprised,
      relatable: row.relatable,
    };
    const previous =
      row.previous === null ? null : reactionKeyFromText(row.previous);
    if (previous !== mine) {
      if (previous) counts[previous] = Math.max(0, counts[previous] - 1);
      if (mine) counts[mine] += 1;
    }
    return ConfessionsService.stateOf(counts, mine);
  }

  /**
   * A moderator's decision on a confession, from the admin panel.
   *
   *   REMOVED  taken down for good; the author cannot bring it back.
   *   HIDDEN   kept off the feed pending a decision (what auto-hide does).
   *   VISIBLE  restored — e.g. after auto-hide caught a brigade. The reports
   *            still open against it are closed as rejected at the same time,
   *            so `syncConfessionReports` (which counts open reports only)
   *            does not hide it again on the next single report.
   */
  async moderate(
    confessionId: string,
    status: ConfessionStatus,
    adminId: string | undefined,
  ): Promise<{ id: string; status: ConfessionStatus; reportCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.confession.findUnique({
        where: { id: confessionId },
        select: { id: true },
      });
      if (!found) throw notFound();
      let reportCount: number | undefined;
      if (status === ConfessionStatus.VISIBLE) {
        await tx.report.updateMany({
          where: {
            targetType: 'CONFESSION',
            targetId: confessionId,
            status: { in: OPEN_REPORT_STATUSES },
          },
          data: {
            status: ReportStatus.REJECTED,
            resolution: 'Confession restored by a moderator.',
            resolvedAt: new Date(),
            ...(adminId ? { resolvedBy: adminId } : {}),
          },
        });
        reportCount = 0;
      }
      return tx.confession.update({
        where: { id: confessionId },
        data: { status, ...(reportCount === undefined ? {} : { reportCount }) },
        select: { id: true, status: true, reportCount: true },
      });
    });
  }

  /**
   * The author takes their own confession down. Ownership is the only test —
   * not the caller's current campus — so someone who has since moved college
   * (or lost their affiliation) can still delete what they wrote.
   */
  async remove(userId: string, confessionId: string): Promise<{ ok: true }> {
    const profileId = await this.profileIdOf(userId);
    if (!profileId) throw notFound();
    const result = await this.prisma.confession.updateMany({
      where: {
        id: confessionId,
        profileId,
        status: { not: ConfessionStatus.REMOVED },
      },
      data: { status: ConfessionStatus.REMOVED },
    });
    if (result.count === 0) throw notFound();
    return { ok: true };
  }
}

/**
 * Called after a CONFESSION report is stored. Recomputes `reportCount` as the
 * number of distinct reporters with an open report and hides a VISIBLE confession once that
 * reaches the threshold, pending moderator review. A moderator's REMOVED is
 * never overwritten, and a HIDDEN one stays hidden.
 */
export async function syncConfessionReports(
  prisma: Pick<PrismaService, 'report' | 'confession'>,
  confessionId: string,
): Promise<{ reporters: number; hidden: boolean }> {
  // Open reports only: once a moderator has ruled on a confession (and closed
  // its reports), the old reports must not count towards hiding it again.
  const reporters = await prisma.report.findMany({
    where: {
      targetType: 'CONFESSION',
      targetId: confessionId,
      status: { in: OPEN_REPORT_STATUSES },
    },
    distinct: ['reporterId'],
    select: { reporterId: true },
  });
  const count = reporters.length;
  await prisma.confession.updateMany({
    where: { id: confessionId },
    data: { reportCount: count },
  });
  if (count < CONFESSION_AUTO_HIDE_REPORTERS) {
    return { reporters: count, hidden: false };
  }
  const hidden = await prisma.confession.updateMany({
    where: { id: confessionId, status: ConfessionStatus.VISIBLE },
    data: { status: ConfessionStatus.HIDDEN },
  });
  return { reporters: count, hidden: hidden.count > 0 };
}
