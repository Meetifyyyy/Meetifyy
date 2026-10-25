import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfessionStatus, Prisma, ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

/**
 * What a client sees of a confession. Deliberately carries no user id, profile
 * id, name, username, avatar or email: the handle is the only identity.
 */
export interface ConfessionDto {
  id: string;
  handle: string;
  content: string;
  createdAt: string;
  relateCount: number;
  relatedByMe: boolean;
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

export interface RelateState {
  relateCount: number;
  relatedByMe: boolean;
}

const CONFESSION_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  relateCount: true,
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
  constructor(private readonly prisma: PrismaService) {}

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
    relatedByMe: boolean,
  ): ConfessionDto {
    return {
      id: row.id,
      handle: row.profile.handle,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      relateCount: row.relateCount,
      relatedByMe,
      isMine: myProfileId !== null && row.profileId === myProfileId,
    };
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

    let related = new Set<string>();
    if (myProfileId && page.length > 0) {
      const relates = await this.prisma.confessionRelate.findMany({
        where: {
          profileId: myProfileId,
          confessionId: { in: page.map((r) => r.id) },
        },
        select: { confessionId: true },
      });
      related = new Set(relates.map((r) => r.confessionId));
    }

    const last = page[page.length - 1];
    return {
      confessions: page.map((r) =>
        this.toDto(r, myProfileId, related.has(r.id)),
      ),
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
    return { confession: this.toDto(row, profileId, false) };
  }

  /** A VISIBLE confession on this campus, or 404 — never a cross-campus hint. */
  private async requireVisible(
    tx: Prisma.TransactionClient,
    id: string,
    collegeId: string,
  ): Promise<void> {
    const found = await tx.confession.findFirst({
      where: { id, collegeId, status: ConfessionStatus.VISIBLE },
      select: { id: true },
    });
    if (!found) throw notFound();
  }

  async relate(
    userId: string,
    collegeId: string,
    confessionId: string,
  ): Promise<RelateState> {
    const profileId = await this.requireProfileId(userId);
    return this.prisma.$transaction(async (tx) => {
      await this.requireVisible(tx, confessionId, collegeId);
      const inserted = await tx.confessionRelate.createMany({
        data: [{ confessionId, profileId }],
        skipDuplicates: true,
      });
      return this.finishRelate(tx, confessionId, inserted.count, true);
    });
  }

  async unrelate(
    userId: string,
    collegeId: string,
    confessionId: string,
  ): Promise<RelateState> {
    const profileId = await this.requireProfileId(userId);
    return this.prisma.$transaction(async (tx) => {
      await this.requireVisible(tx, confessionId, collegeId);
      const removed = await tx.confessionRelate.deleteMany({
        where: { confessionId, profileId },
      });
      return this.finishRelate(tx, confessionId, -removed.count, false);
    });
  }

  /** Applies the row delta (0 when the call was a no-op) to the counter. */
  private async finishRelate(
    tx: Prisma.TransactionClient,
    confessionId: string,
    delta: number,
    relatedByMe: boolean,
  ): Promise<RelateState> {
    if (delta !== 0) {
      const updated = await tx.confession.update({
        where: { id: confessionId },
        data: { relateCount: { increment: delta } },
        select: { relateCount: true },
      });
      return { relateCount: Math.max(0, updated.relateCount), relatedByMe };
    }
    const current = await tx.confession.findUniqueOrThrow({
      where: { id: confessionId },
      select: { relateCount: true },
    });
    return { relateCount: Math.max(0, current.relateCount), relatedByMe };
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
