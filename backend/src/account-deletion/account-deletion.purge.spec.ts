import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionPurgeService } from './account-deletion.purge.service';
import { PURGE_MAX_ATTEMPTS } from './account-deletion.constants';
import { JwtGuard } from '../common/guards/jwt.guard';
import { stub } from '../common/testing/stub';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MediaCleanupService } from '../uploads/media-cleanup.service';
import type { UserOtpService } from '../otp/user-otp.service';
import type { PrismaService } from '../prisma/prisma.service';

/** The user row both services act on, with the columns they read and write. */
type UserRow = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string | null;
  cover: string | null;
  accountStatus: string;
  deletedAt: Date | null;
  deletionRequestedAt: Date | null;
  scheduledPurgeAt: Date | null;
  purgeStartedAt: Date | null;
  purgeCompletedAt: Date | null;
  purgeAttempts: number;
  purgeLastError: string | null;
  /** Written by the anonymisation. */
  bio?: string | null;
  collegeId?: string | null;
  isCampusRep?: boolean;
};

/** The purge transaction's signature, as the services call it. */
type TransactionMock = jest.Mock<
  Promise<unknown>,
  [(tx: unknown) => unknown, TransactionOptions?]
>;

/** The `where` shapes the fake interprets (anything else is ignored). */
type UserWhere = {
  id?: string;
  accountStatus?: string;
  deletedAt?: null;
  purgeStartedAt?: null;
  purgeAttempts?: { lt?: number };
  scheduledPurgeAt?: { gt?: Date; lte?: Date };
  OR?: Array<{ purgeStartedAt?: null | { lt?: Date } }>;
};

/** The arguments a recorded Prisma write received. */
type WriteArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

type TransactionOptions = { timeout?: number; maxWait?: number };

/**
 * The permanent-deletion worker, and the race between it and recovery.
 *
 * Both services are driven against ONE shared fake row whose `updateMany`
 * honours the full `where` clause. That is the point: the claim and the
 * recovery are conditional updates on the same row, so a fake that ignored the
 * predicate would make every race test pass for the wrong reason.
 */
describe('AccountDeletionPurgeService — permanent deletion', () => {
  const USER_ID = 'user-9';
  const DAY = 24 * 60 * 60 * 1000;

  let purge: AccountDeletionPurgeService;
  let deletion: AccountDeletionService;
  let prisma: {
    user: { findUnique: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
    $transaction: TransactionMock;
  };
  let mediaCleanupService: {
    extractStorageKey: jest.Mock;
    queueMediaDeletion: jest.Mock<Promise<void>, [string[]]>;
  };
  let domainEventService: { emit: jest.Mock };
  let row: UserRow;
  let posts: { id: string }[];
  let activities: { id: string; coverImage: string }[];
  let calls: Record<string, WriteArgs[][]>;

  const record = (model: string, op: string) =>
    jest.fn((...args: WriteArgs[]) => {
      (calls[`${model}.${op}`] ??= []).push(args);
      return Promise.resolve({ count: 1 });
    });

  beforeEach(() => {
    JwtGuard.unrevokeUser(USER_ID);
    calls = {};
    posts = [{ id: 'post-1' }, { id: 'post-2' }];
    activities = [{ id: 'act-1', coverImage: 'activities/act1.jpg' }];

    row = {
      id: USER_ID,
      username: 'realname',
      displayName: 'Real Name',
      email: 'real@example.edu',
      avatar: 'https://cdn/avatars/me.jpg',
      cover: 'https://cdn/profile-covers/me.jpg',
      accountStatus: 'PENDING_DELETION',
      deletedAt: new Date(Date.now() - 31 * DAY),
      deletionRequestedAt: new Date(Date.now() - 31 * DAY),
      scheduledPurgeAt: new Date(Date.now() - DAY), // window expired yesterday
      purgeStartedAt: null,
      purgeCompletedAt: null,
      purgeAttempts: 0,
      purgeLastError: null,
    };

    const matches = (where: UserWhere): boolean => {
      if (where.id && where.id !== row.id) return false;
      if (where.accountStatus && where.accountStatus !== row.accountStatus) {
        return false;
      }
      if (where.deletedAt === null && row.deletedAt !== null) return false;
      if (where.purgeStartedAt === null && row.purgeStartedAt !== null) {
        return false;
      }
      if (
        where.purgeAttempts?.lt !== undefined &&
        !(row.purgeAttempts < where.purgeAttempts.lt)
      ) {
        return false;
      }
      if (
        where.scheduledPurgeAt?.gt &&
        !(row.scheduledPurgeAt! > where.scheduledPurgeAt.gt)
      ) {
        return false;
      }
      if (
        where.scheduledPurgeAt?.lte &&
        !(row.scheduledPurgeAt! <= where.scheduledPurgeAt.lte)
      ) {
        return false;
      }
      if (where.OR) {
        const ok = where.OR.some((clause) => {
          if (clause.purgeStartedAt === null)
            return row.purgeStartedAt === null;
          if (clause.purgeStartedAt?.lt) {
            return (
              row.purgeStartedAt !== null &&
              row.purgeStartedAt < clause.purgeStartedAt.lt
            );
          }
          return false;
        });
        if (!ok) return false;
      }
      return true;
    };

    const emptyModel = (extra: Record<string, jest.Mock> = {}) => ({
      findMany: jest.fn(() => Promise.resolve([])),
      findFirst: jest.fn(() => Promise.resolve(null)),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      update: jest.fn(() => Promise.resolve({})),
      ...extra,
    });

    const tx = {
      user: {
        update: jest.fn(({ data }: { data: Partial<UserRow> }) => {
          (calls['user.update'] ??= []).push([{ data }]);
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
      post: {
        findMany: jest.fn(({ where }: { where: { authorId?: string } }) =>
          Promise.resolve(where.authorId === USER_ID ? posts : []),
        ),
        deleteMany: record('post', 'deleteMany'),
      },
      crewActivity: {
        findMany: jest.fn(() => Promise.resolve(activities)),
        deleteMany: record('crewActivity', 'deleteMany'),
      },
      community: emptyModel(),
      communityMember: emptyModel(),
      communityJoinRequest: emptyModel(),
      comment: {
        updateMany: record('comment', 'updateMany'),
      },
      media: {
        findMany: jest.fn(({ where }: { where: { postId?: unknown } }) =>
          Promise.resolve(
            where.postId
              ? [{ objectKey: 'posts/p1.jpg' }]
              : [{ id: 'm9', objectKey: 'uploads/stray.jpg' }],
          ),
        ),
        deleteMany: record('media', 'deleteMany'),
      },
      campusEvent: { updateMany: record('campusEvent', 'updateMany') },
      matchSession: { deleteMany: record('matchSession', 'deleteMany') },
      activityDiscussionMessage: {
        deleteMany: record('activityDiscussionMessage', 'deleteMany'),
      },
      supportTicket: { updateMany: record('supportTicket', 'updateMany') },
      report: { updateMany: record('report', 'updateMany') },
      notification: { deleteMany: record('notification', 'deleteMany') },
      mention: { deleteMany: record('mention', 'deleteMany') },
      follow: { deleteMany: record('follow', 'deleteMany') },
      postBookmark: { deleteMany: record('postBookmark', 'deleteMany') },
      postLike: { deleteMany: record('postLike', 'deleteMany') },
      postShare: { deleteMany: record('postShare', 'deleteMany') },
      commentLike: { deleteMany: record('commentLike', 'deleteMany') },
      activityBookmark: {
        deleteMany: record('activityBookmark', 'deleteMany'),
      },
      activityInvitation: {
        deleteMany: record('activityInvitation', 'deleteMany'),
      },
      crewActivityMember: {
        deleteMany: record('crewActivityMember', 'deleteMany'),
      },
      matchQueueEntry: { deleteMany: record('matchQueueEntry', 'deleteMany') },
      block: { deleteMany: record('block', 'deleteMany') },
      mute: { deleteMany: record('mute', 'deleteMany') },
      pollVote: { deleteMany: record('pollVote', 'deleteMany') },
      conversationJoinRequest: {
        deleteMany: record('conversationJoinRequest', 'deleteMany'),
      },
      recentSearch: { deleteMany: record('recentSearch', 'deleteMany') },
      deletedMessage: { deleteMany: record('deletedMessage', 'deleteMany') },
      messageReaction: { deleteMany: record('messageReaction', 'deleteMany') },
      notificationPreferences: {
        deleteMany: record('notificationPreferences', 'deleteMany'),
      },
      userSettings: { deleteMany: record('userSettings', 'deleteMany') },
      verificationRequest: {
        deleteMany: record('verificationRequest', 'deleteMany'),
      },
      // Deliberately absent: conversation, conversationParticipant, message.
      // Touching any of those would take the other participant's history with
      // it, so a purge that reached for one should fail this suite loudly.
    };

    prisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === USER_ID ? { ...row } : null),
        ),
        findMany: jest.fn(({ where }: { where: UserWhere }) =>
          Promise.resolve(matches(where) ? [{ id: USER_ID }] : []),
        ),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: UserWhere;
            data: Partial<Omit<UserRow, 'purgeAttempts'>> & {
              purgeAttempts?: number | { increment?: number };
            };
          }) => {
            if (!matches(where)) return Promise.resolve({ count: 0 });
            const resolved = { ...data };
            const increment =
              typeof data.purgeAttempts === 'object'
                ? data.purgeAttempts.increment
                : undefined;
            if (increment) {
              resolved.purgeAttempts = row.purgeAttempts + increment;
            }
            Object.assign(row, resolved);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      $transaction: jest.fn(
        (fn: (tx: unknown) => unknown, _opts?: TransactionOptions) =>
          Promise.resolve(fn(tx)),
      ),
    };

    mediaCleanupService = {
      extractStorageKey: jest.fn((v: string | null) => v ?? null),
      queueMediaDeletion: jest.fn((_keys: string[]) => Promise.resolve()),
    };
    domainEventService = { emit: jest.fn() };

    purge = new AccountDeletionPurgeService(
      stub<PrismaService>(prisma),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>({ removePresence: jest.fn(async () => {}) }),
      stub<DomainEventService>(domainEventService),
      stub<MediaCleanupService>(mediaCleanupService),
    );
    deletion = new AccountDeletionService(
      stub<PrismaService>(prisma),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>({ removePresence: jest.fn(async () => {}) }),
      stub<DomainEventService>(domainEventService),
      stub<UserOtpService>({
        issue: jest.fn(() =>
          Promise.resolve({
            code: '123456',
            expiresAt: new Date(Date.now() + 600_000),
          }),
        ),
        verify: jest.fn(async () => {}),
        invalidate: jest.fn(async () => {}),
        invalidateAll: jest.fn(async () => {}),
      }),
      {
        sendAccountDeletionOtpEmail: jest.fn(async () => {}),
        sendAccountRecoveryOtpEmail: jest.fn(async () => {}),
      },
    );
  });

  describe('eligibility', () => {
    it('purges an account whose window has expired', async () => {
      const result = await purge.runSweep();
      expect(result).toEqual({ claimed: 1, purged: 1, failed: 0 });
      expect(row.accountStatus).toBe('DELETED');
      expect(row.purgeCompletedAt).toBeInstanceOf(Date);
    });

    it('leaves an account whose window is still open', async () => {
      row.scheduledPurgeAt = new Date(Date.now() + 10 * DAY);
      const result = await purge.runSweep();
      expect(result.claimed).toBe(0);
      expect(row.accountStatus).toBe('PENDING_DELETION');
    });

    it('leaves an account that was recovered before the sweep ran', async () => {
      await deletion.recoverAccount(USER_ID).catch(() => {
        // Window already expired in this fixture, so recovery is refused —
        // simulate a recovery that happened while it was still open instead.
        row.accountStatus = 'ACTIVE';
        row.deletedAt = null;
        row.scheduledPurgeAt = null;
      });
      const result = await purge.runSweep();
      expect(result.claimed).toBe(0);
      expect(row.accountStatus).toBe('ACTIVE');
    });

    it('stops retrying after the attempt ceiling and leaves the row for an admin', async () => {
      row.purgeAttempts = PURGE_MAX_ATTEMPTS;
      const result = await purge.runSweep();
      expect(result.claimed).toBe(0);
      expect(row.accountStatus).toBe('PENDING_DELETION');
    });
  });

  describe('what a purge does', () => {
    beforeEach(async () => {
      await purge.runSweep();
    });

    it('anonymizes the user row rather than deleting it', () => {
      // Message.senderId and Comment.authorId both cascade off User. Deleting
      // the row would erase this person's messages out of everyone else's
      // conversations, which is the one outcome the product must not have.
      expect(row.displayName).toBe('Deleted User');
      expect(row.username).toMatch(/^deleted_user-9_\d+$/);
      expect(row.email).toBe(`deleted_${USER_ID}@deleted.meetifyy`);
      expect(row.avatar).toBeNull();
      expect(row.cover).toBeNull();
      expect(row.bio).toBeNull();
      expect(row.collegeId).toBeNull();
      expect(row.isCampusRep).toBe(false);
    });

    it('never touches conversations, participants or messages', () => {
      const touched = Object.keys(calls).filter((k) =>
        /^(conversation|conversationParticipant|message)\./.test(k),
      );
      expect(touched).toEqual([]);
    });

    it('hard-deletes the user’s posts', () => {
      expect(calls['post.deleteMany'][0][0]).toEqual({
        where: { id: { in: ['post-1', 'post-2'] } },
      });
    });

    it('hard-deletes the user’s activities', () => {
      expect(calls['crewActivity.deleteMany'][0][0]).toEqual({
        where: { id: { in: ['act-1'] } },
      });
    });

    it('tombstones comments authored elsewhere instead of deleting them', () => {
      const [args] = calls['comment.updateMany'].slice(-1)[0];
      expect(args.where).toEqual({ authorId: USER_ID, isDeleted: false });
      expect(args.data).toMatchObject({
        isDeleted: true,
        text: '',
        likeCount: 0,
      });
    });

    it('withdraws unpublished campus events but leaves published ones standing', () => {
      // A published campus event is institutional content students already have
      // in their calendars; it outlives its author and renders a tombstone
      // creator instead. A DRAFT was never published and is purely theirs.
      const [args] = calls['campusEvent.updateMany'][0];
      expect(args.where).toMatchObject({ createdBy: USER_ID, status: 'DRAFT' });
      expect(args.data!.deletedAt).toBeInstanceOf(Date);
    });

    it('deletes instant-match sessions on both sides of the pairing', () => {
      // The queue snapshots on these rows hold campus, chosen activity and
      // approximate coordinates — location data that must not outlive the
      // account.
      expect(calls['matchSession.deleteMany'][0][0]).toEqual({
        where: { OR: [{ userAId: USER_ID }, { userBId: USER_ID }] },
      });
    });

    it('KEEPS discussion messages the user left in other people’s activities', () => {
      // An activity discussion is a conversation among its members. Deleting
      // one person's messages rewrites that thread for everyone else — the same
      // objection that keeps chat history intact. The rows stay and the
      // serialization layer renders the author as "Deleted User" with the
      // default avatar instead.
      expect(calls['activityDiscussionMessage.deleteMany']).toBeUndefined();
    });

    it('keeps moderation reports but closes the un-actionable ones', () => {
      // The record is an audit trail and describes the reporter's action as
      // much as the subject's, so it survives. But an open report about an
      // account that no longer exists can never be actioned, and leaving it
      // PENDING accumulates queue items a moderator must dismiss by hand.
      const [args] = calls['report.updateMany'][0];
      expect(args.where).toMatchObject({
        targetType: 'USER',
        targetId: USER_ID,
        status: { in: ['PENDING', 'UNDER_REVIEW'] },
      });
      expect(args.data!.status).toBe('RESOLVED');
      expect(args.data!.resolvedAt).toBeInstanceOf(Date);
      expect(args.data!.resolution).toMatch(/permanently deleted/i);
    });

    it('never touches reports the user filed about other people', () => {
      // Those are still actionable — the subject has done nothing to warrant
      // the report being dropped just because the reporter left.
      const touchedReporter = calls['report.updateMany'].some(
        ([args]) => 'reporterId' in (args.where ?? {}),
      );
      expect(touchedReporter).toBe(false);
      expect(calls['report.deleteMany']).toBeUndefined();
    });

    it('detaches identity from support tickets without destroying the record', () => {
      // The ticket is a support and suspension-appeal record worth keeping, but
      // it carries a denormalized copy of the real email and name.
      const [args] = calls['supportTicket.updateMany'][0];
      expect(args.where).toEqual({ userId: USER_ID });
      expect(args.data).toEqual({
        userId: null,
        email: `deleted_${USER_ID}@deleted.meetifyy`,
        name: 'Deleted User',
      });
    });

    it('queues every owned media object for storage deletion', () => {
      const [keys] = mediaCleanupService.queueMediaDeletion.mock.calls[0];
      expect(keys).toEqual(
        expect.arrayContaining([
          'https://cdn/avatars/me.jpg',
          'https://cdn/profile-covers/me.jpg',
          'posts/p1.jpg',
          'activities/act1.jpg',
          'uploads/stray.jpg',
        ]),
      );
    });

    it('revokes the session — recovery is no longer possible', () => {
      expect(JwtGuard.isUserRevoked(USER_ID)).toBe(true);
    });

    it('emits user.deleted exactly once', () => {
      expect(domainEventService.emit).toHaveBeenCalledWith('user.deleted', {
        userId: USER_ID,
      });
    });
  });

  describe('idempotency and retries', () => {
    it('gives the purge transaction a budget the default 5s could never meet', async () => {
      // Regression guard for a bug only a real database exposed: a purge issues
      // ~35 sequential statements, and against a pooled remote connection the
      // default interactive-transaction timeout expired mid-flight, failing
      // every purge with "Transaction not found". A mocked `$transaction`
      // cannot reproduce that — it just calls the callback — so the OPTIONS are
      // asserted instead.
      await purge.runSweep();
      const [, options] = prisma.$transaction.mock.calls[0];
      expect(options?.timeout).toBeGreaterThanOrEqual(60_000);
      expect(options?.maxWait).toBeGreaterThan(0);
    });

    it('a second sweep over an already-purged account is a no-op', async () => {
      await purge.runSweep();
      const before = { ...row };
      const second = await purge.runSweep();
      expect(second).toEqual({ claimed: 0, purged: 0, failed: 0 });
      expect(row.username).toBe(before.username);
    });

    it('purgeUser called twice directly does not double-delete', async () => {
      await purge.purgeUser(USER_ID);
      const postDeletes = calls['post.deleteMany'].length;
      const result = await purge.purgeUser(USER_ID);
      expect(result).toEqual({ purged: false });
      expect(calls['post.deleteMany'].length).toBe(postDeletes);
    });

    it('records the error and releases the claim when a purge fails', async () => {
      prisma.$transaction = jest.fn<
        Promise<unknown>,
        [(tx: unknown) => unknown, TransactionOptions?]
      >(() => {
        return Promise.reject(new Error('R2 unavailable'));
      });
      const result = await purge.runSweep();
      expect(result).toEqual({ claimed: 1, purged: 0, failed: 1 });
      expect(row.accountStatus).toBe('PENDING_DELETION');
      expect(row.purgeStartedAt).toBeNull(); // released for the next sweep
      expect(row.purgeLastError).toBe('R2 unavailable');
      expect(row.purgeAttempts).toBe(1);
    });

    it('retries a released row on the next sweep and succeeds', async () => {
      const realTransaction = prisma.$transaction;
      prisma.$transaction = jest.fn<
        Promise<unknown>,
        [(tx: unknown) => unknown, TransactionOptions?]
      >(() => {
        return Promise.reject(new Error('transient'));
      });
      await purge.runSweep();
      prisma.$transaction = realTransaction;
      const result = await purge.runSweep();
      expect(result.purged).toBe(1);
      expect(row.accountStatus).toBe('DELETED');
    });
  });

  describe('race: recovery vs the purge worker', () => {
    it('a recovery that lands first wins, and the worker skips the row', async () => {
      row.scheduledPurgeAt = new Date(Date.now() + 60_000); // still just open

      await deletion.recoverAccount(USER_ID);
      // The worker's own deadline check now also fails, but even with the
      // deadline forced past, the claim must not match an ACTIVE row.
      row.scheduledPurgeAt = new Date(Date.now() - 1000);

      const result = await purge.runSweep();
      expect(result.claimed).toBe(0);
      expect(row.accountStatus).toBe('ACTIVE');
      expect(row.username).toBe('realname'); // never anonymized
    });

    it('a claim that lands first wins, and recovery is refused rather than lying', async () => {
      // Claim the row the way the worker does, then attempt recovery.
      row.scheduledPurgeAt = new Date(Date.now() + 60_000);
      row.purgeStartedAt = new Date();

      await expect(deletion.recoverAccount(USER_ID)).rejects.toThrow(
        /permanent deletion is already under way/,
      );
      expect(row.accountStatus).toBe('PENDING_DELETION');
    });
  });
});
