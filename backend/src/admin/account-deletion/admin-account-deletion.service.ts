import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountDeletionService } from '../../account-deletion/account-deletion.service';
import { AccountDeletionPurgeService } from '../../account-deletion/account-deletion.purge.service';
import {
  PURGE_MAX_ATTEMPTS,
  RECOVERY_WINDOW_DAYS,
} from '../../account-deletion/account-deletion.constants';

export type DeletionQueueFilter = 'pending' | 'failed' | 'completed' | 'all';

/**
 * Exactly the columns the queue selects. Written out rather than inferred with
 * `any` so that adding a field to the select is a deliberate act — this row is
 * serialized straight to the admin client, and an accidental `bio` or `avatar`
 * here would put the profile of somebody who asked to be forgotten on screen.
 */
interface DeletionQueueSource {
  id: string;
  username: string;
  email: string;
  accountStatus: string;
  deletionRequestedAt: Date | null;
  scheduledPurgeAt: Date | null;
  purgeStartedAt: Date | null;
  purgeCompletedAt: Date | null;
  purgeAttempts: number;
  purgeLastError: string | null;
  college: { id: string; name: string } | null;
}

/**
 * The admin view of the account-deletion lifecycle.
 *
 * Read-mostly on purpose. The three actions it exposes are the ones an operator
 * genuinely needs and that have a real backend behind them — restore an account
 * on the owner's behalf, retry a purge that a broken dependency left stuck, and
 * run it now rather than waiting for the sweep. Anything an admin cannot
 * actually do is not rendered as a button.
 *
 * It deliberately does NOT expose the account's bio, avatar, posts or contact
 * details. The queue exists to manage a retention deadline, not to browse the
 * profile of someone who asked to be forgotten.
 */
@Injectable()
export class AdminAccountDeletionService {
  private readonly logger = new Logger(AdminAccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deletion: AccountDeletionService,
    private readonly purge: AccountDeletionPurgeService,
  ) {}

  async list(query: {
    filter?: DeletionQueueFilter;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;
    const now = new Date();

    const where = this.buildWhere(query.filter ?? 'pending', query.search);

    const [total, rows, counts] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        // Soonest deadline first: the rows an operator can still act on.
        orderBy: [{ scheduledPurgeAt: 'asc' }, { deletionRequestedAt: 'asc' }],
        select: {
          id: true,
          // The anonymized placeholder for a purged row, the real one while
          // pending — an operator has to be able to identify the account they
          // are restoring.
          username: true,
          email: true,
          accountStatus: true,
          deletionRequestedAt: true,
          scheduledPurgeAt: true,
          purgeStartedAt: true,
          purgeCompletedAt: true,
          purgeAttempts: true,
          purgeLastError: true,
          college: { select: { id: true, name: true } },
        },
      }),
      this.counts(now),
    ]);

    return {
      requests: rows.map((row) => this.toQueueRow(row, now)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      counts,
      recoveryWindowDays: RECOVERY_WINDOW_DAYS,
    };
  }

  async getOne(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        accountStatus: true,
        createdAt: true,
        deletionRequestedAt: true,
        scheduledPurgeAt: true,
        purgeStartedAt: true,
        purgeCompletedAt: true,
        purgeAttempts: true,
        purgeLastError: true,
        college: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('Account not found');
    return { ...this.toQueueRow(row, new Date()), createdAt: row.createdAt };
  }

  /**
   * Restores an account on the owner's behalf — a support request, or a
   * deletion the person says they did not intend.
   *
   * Runs through exactly the same service the user's own Recover button uses,
   * so it inherits the same window check and the same race handling against the
   * purge worker rather than being a second, subtly different path.
   */
  async restore(userId: string) {
    const status = await this.deletion.recoverAccount(userId);
    this.logger.log(`Admin restored account ${userId} from pending deletion`);
    return { success: true, status };
  }

  /**
   * Runs the purge for one account now.
   *
   * Two real uses: retrying a row whose purge failed (a storage outage, say),
   * and completing a deletion an operator has confirmed should not wait. It
   * calls the same idempotent `purgeUser` the worker does, so a row already
   * mid-purge or already finished is a safe no-op rather than a double-delete.
   */
  async purgeNow(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true, scheduledPurgeAt: true },
    });
    if (!row) throw new NotFoundException('Account not found');

    if (row.accountStatus !== 'PENDING_DELETION') {
      throw new ConflictException(
        'This account is not scheduled for deletion.',
      );
    }

    // The 30 days are a promise to the account owner, not a scheduling detail,
    // so an operator cannot short-circuit them. This route exists to retry a
    // purge that a broken dependency left stuck and to finish one that is
    // already due — not to destroy an account its owner can still recover.
    // Enforced here rather than only by hiding the button, because the button
    // is not what an API client sees.
    if (!row.scheduledPurgeAt || row.scheduledPurgeAt > new Date()) {
      throw new ConflictException(
        'This account is still inside its 30-day recovery window and cannot be deleted yet.',
      );
    }

    // Clear the attempt ceiling so a row parked as failed is retryable; the
    // operator asking for it is the deliberate decision that ceiling protects.
    await this.prisma.user.updateMany({
      where: { id: userId, accountStatus: 'PENDING_DELETION' },
      data: { purgeAttempts: 0, purgeStartedAt: new Date() },
    });

    const result = await this.purge.purgeUser(userId);
    this.logger.log(
      `Admin ran permanent deletion for ${userId} (purged=${result.purged})`,
    );
    return { success: true, ...result };
  }

  /** Runs one sweep immediately instead of waiting for the next scheduled one. */
  async runSweep() {
    const result = await this.purge.runSweep();
    this.logger.log(`Admin-triggered purge sweep: ${JSON.stringify(result)}`);
    return { success: true, ...result };
  }

  private buildWhere(
    filter: DeletionQueueFilter,
    search?: string,
  ): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    switch (filter) {
      case 'pending':
        where.accountStatus = 'PENDING_DELETION';
        break;
      case 'failed':
        // Rows the worker has given up on. These are the only ones that need a
        // human, which is why they get their own filter rather than being
        // buried in the pending list.
        where.accountStatus = 'PENDING_DELETION';
        where.purgeAttempts = { gte: PURGE_MAX_ATTEMPTS };
        break;
      case 'completed':
        where.accountStatus = 'DELETED';
        where.purgeCompletedAt = { not: null };
        break;
      case 'all':
        where.OR = [
          { accountStatus: 'PENDING_DELETION' },
          { accountStatus: 'DELETED', purgeCompletedAt: { not: null } },
        ];
        break;
    }

    if (search) {
      const term = { contains: search, mode: 'insensitive' as const };
      const searchOr = [{ username: term }, { email: term }, { id: search }];
      // `where.OR` is already taken by the 'all' filter, so nest rather than
      // overwrite it — otherwise searching in 'all' would silently widen the
      // status filter instead of narrowing the result.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchOr }];
        delete where.OR;
      } else {
        where.OR = searchOr;
      }
    }

    return where;
  }

  private async counts(now: Date) {
    const [pending, failed, dueNow, completed] = await Promise.all([
      this.prisma.user.count({ where: { accountStatus: 'PENDING_DELETION' } }),
      this.prisma.user.count({
        where: {
          accountStatus: 'PENDING_DELETION',
          purgeAttempts: { gte: PURGE_MAX_ATTEMPTS },
        },
      }),
      this.prisma.user.count({
        where: {
          accountStatus: 'PENDING_DELETION',
          scheduledPurgeAt: { lte: now },
        },
      }),
      this.prisma.user.count({
        where: { accountStatus: 'DELETED', purgeCompletedAt: { not: null } },
      }),
    ]);
    return { pending, failed, dueNow, completed };
  }

  private toQueueRow(row: DeletionQueueSource, now: Date) {
    const purgeAt: Date | null = row.scheduledPurgeAt ?? null;
    const msLeft = purgeAt ? purgeAt.getTime() - now.getTime() : null;
    const isPending = row.accountStatus === 'PENDING_DELETION';
    const hasFailed = isPending && row.purgeAttempts >= PURGE_MAX_ATTEMPTS;

    return {
      userId: row.id,
      username: row.username,
      email: row.email,
      college: row.college?.name ?? null,
      accountStatus: row.accountStatus,
      deletionRequestedAt: row.deletionRequestedAt,
      scheduledPurgeAt: purgeAt,
      purgeCompletedAt: row.purgeCompletedAt,
      purgeAttempts: row.purgeAttempts,
      purgeLastError: row.purgeLastError,
      /** Negative once the deadline has passed, null for a completed row. */
      msRemaining: isPending ? msLeft : null,
      daysRemaining:
        isPending && msLeft !== null
          ? Math.max(0, Math.floor(msLeft / (24 * 60 * 60 * 1000)))
          : null,
      dueNow: Boolean(isPending && msLeft !== null && msLeft <= 0),
      /** Whether a purge is currently claimed by a worker. */
      purgeInProgress: Boolean(isPending && row.purgeStartedAt),
      status: !isPending
        ? 'completed'
        : hasFailed
          ? 'failed'
          : msLeft !== null && msLeft <= 0
            ? 'due'
            : 'pending',
      // The UI renders an action only when its flag is true, so a button that
      // could not work is never shown. Restoring is impossible once the row is
      // claimed or the window has closed; purging is impossible once done.
      canRestore: Boolean(
        isPending && !row.purgeStartedAt && msLeft !== null && msLeft > 0,
      ),
      // Mirrors the server rule exactly, so the panel never offers an action
      // the backend would refuse: only a row that is actually due (or one the
      // worker has given up on) can be purged by hand.
      canPurgeNow: Boolean(isPending && msLeft !== null && msLeft <= 0),
    };
  }
}
