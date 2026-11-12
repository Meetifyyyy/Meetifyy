import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionPurgeService } from './account-deletion.purge.service';
import { PURGE_MAX_ATTEMPTS } from './account-deletion.constants';
import { JwtGuard } from '../common/guards/jwt.guard';
import type { UserSessionService } from '../auth/session/user-session.service';
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

/** A recording model whose reads a test can script. */
type FakeModel = Record<
  'findMany' | 'findFirst' | 'deleteMany' | 'updateMany' | 'update',
  jest.Mock
>;

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
  let revokeAllForUser: jest.Mock;
  let row: UserRow;
  let posts: { id: string }[];
  let activities: { id: string; coverImage: string }[];
  let calls: Record<string, WriteArgs[][]>;
  let communityModel: FakeModel;
  let memberModel: FakeModel;
  /** Statements that touch community membership, in the order they ran. */
  let sequence: string[];

  const record = (model: string, op: string) =>
    jest.fn((...args: WriteArgs[]) => {
      (calls[`${model}.${op}`] ??= []).push(args);
      return Promise.resolve({ count: 1 });
    });

  beforeEach(() => {
    JwtGuard.unrevokeUser(USER_ID);
    calls = {};
    sequence = [];
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

    communityModel = emptyModel();
    memberModel = emptyModel({
      deleteMany: jest.fn((...args: WriteArgs[]) => {
        (calls['communityMember.deleteMany'] ??= []).push(args);
        sequence.push(`delete:${JSON.stringify(args[0]?.where)}`);
        return Promise.resolve({ count: 1 });
      }),
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
      community: communityModel,
      communityMember: memberModel,
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
      followRequest: { deleteMany: record('followRequest', 'deleteMany') },
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
      // The vote counts lowered before the votes go (raw SQL).
      $executeRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        (calls['raw.executeRaw'] ??= []).push([{ data: { sql } }]);
        sequence.push(`raw:${sql}`);
        return Promise.resolve(1);
      }),
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
      collegeAffiliation: {
        deleteMany: record('collegeAffiliation', 'deleteMany'),
      },
      confessionProfile: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'cprof-1' })),
        delete: record('confessionProfile', 'delete'),
      },
      confessionReaction: {
        findMany: jest.fn(() =>
          Promise.resolve([{ confessionId: 'cf-a' }, { confessionId: 'cf-b' }]),
        ),
      },
      confession: { updateMany: record('confession', 'updateMany') },
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
    revokeAllForUser = jest.fn(() => Promise.resolve(1));

    purge = new AccountDeletionPurgeService(
      stub<PrismaService>(prisma),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>({ removePresence: jest.fn(async () => {}) }),
      stub<DomainEventService>(domainEventService),
      stub<UserSessionService>({ revokeAllForUser }),
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

    it('releases the verified college email so another account can claim it', () => {
      expect(calls['collegeAffiliation.deleteMany'][0][0]).toEqual({
        where: { userId: USER_ID },
      });
    });

    it('deletes the anonymous confession profile, which takes its confessions with it', () => {
      expect(calls['confessionProfile.delete'][0][0]).toEqual({
        where: { id: 'cprof-1' },
      });
    });

    it('takes the user’s relates off other people’s confession counts first', () => {
      expect(calls['confession.updateMany'][0][0]).toEqual({
        where: { id: { in: ['cf-a', 'cf-b'] }, relateCount: { gt: 0 } },
        data: { relateCount: { decrement: 1 } },
      });
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

    it('revokes every persisted session row, not just this process memory', () => {
      expect(revokeAllForUser).toHaveBeenCalledWith(USER_ID, 'ACCOUNT_DELETED');
    });

    it('lowers the vote count of each option the voter chose, as their votes go', () => {
      const recorded = calls['raw.executeRaw']?.[0]?.[0]?.data?.sql;
      const sql = typeof recorded === 'string' ? recorded : '';
      expect(sql).toMatch(/UPDATE "PollOption"/);
      expect(sql).toMatch(/"voteCount" = GREATEST\(o\."voteCount" - v\.n, 0\)/);
      expect(calls['pollVote.deleteMany']).toHaveLength(1);
    });

    it('lowers each live community count by one before the memberships go', () => {
      const sql = (calls['raw.executeRaw'] ?? [])
        .map(([a]) => String(a.data?.sql))
        .find((q) => q.includes('UPDATE "Community"'));
      expect(sql).toBeDefined();
      const flat = (sql ?? '').replace(/\s+/g, ' ');
      // One statement, never below zero, by the user's own rows only, and
      // never for a soft-deleted community (its count was zeroed on wind-up).
      expect(flat).toContain(
        'SET "memberCount" = GREATEST(c."memberCount" - 1, 0)',
      );
      expect(flat).toContain('FROM "CommunityMember" cm');
      expect(flat).toContain('cm."communityId" = c."id"');
      expect(flat).toContain('cm."userId" = ?');
      expect(flat).toContain('c."deletedAt" IS NULL');
      const update = sequence.findIndex((q) =>
        q.includes('UPDATE "Community"'),
      );
      const del = sequence.findIndex((q) =>
        q.startsWith(`delete:{"userId":"${USER_ID}"}`),
      );
      expect(update).toBeGreaterThanOrEqual(0);
      expect(update).toBeLessThan(del);
      expect(
        (calls['raw.executeRaw'] ?? []).filter(([a]) =>
          String(a.data?.sql).includes('UPDATE "Community"'),
        ),
      ).toHaveLength(1);
    });

    it('drops pending follow requests in both directions', () => {
      const [args] = calls['followRequest.deleteMany'][0];
      expect(args.where).toEqual({
        OR: [{ requesterId: USER_ID }, { targetId: USER_ID }],
      });
    });

    it('emits user.deleted exactly once', () => {
      expect(domainEventService.emit).toHaveBeenCalledWith('user.deleted', {
        userId: USER_ID,
      });
    });
  });

  describe('owned communities', () => {
    const ownedBy = (
      ...rows: Array<{
        id: string;
        isCampusCommunity: boolean;
        collegeId: string | null;
      }>
    ) =>
      communityModel.findMany.mockImplementation(
        ({ where }: { where: { ownerId?: string } }) =>
          Promise.resolve(
            where.ownerId === USER_ID
              ? rows.map((r) => ({
                  ...r,
                  avatarKey: null,
                  coverKey: null,
                }))
              : [],
          ),
      );

    /** The `community.update` calls as plain objects. */
    const communityUpdates = () =>
      communityModel.update.mock.calls.map(
        ([a]) => a as { where: { id: string }; data: Record<string, unknown> },
      );

    /** Members eligible for the campus rule, by community. */
    const campusHeirs = (heirs: Record<string, string>) =>
      memberModel.findFirst.mockImplementation(
        ({
          where,
        }: {
          where: { communityId: string; role?: string; user?: unknown };
        }) => {
          // Only the campus finder filters on the member's affiliation.
          if (!where.user || where.role !== 'MEMBER') {
            return Promise.resolve(null);
          }
          const id = heirs[where.communityId];
          return Promise.resolve(id ? { userId: id } : null);
        },
      );

    it('hands a campus community to a member with an active affiliation at its college', async () => {
      ownedBy({ id: 'camp-1', isCampusCommunity: true, collegeId: 'col-1' });
      campusHeirs({ 'camp-1': 'eligible-1' });
      await purge.runSweep();

      const finder = memberModel.findFirst.mock.calls
        .map(([a]) => a as { where: Record<string, unknown> })
        .find((a) => a.where.role === 'MEMBER');
      expect(finder?.where).toMatchObject({
        communityId: 'camp-1',
        user: {
          collegeAffiliation: { is: { collegeId: 'col-1', revokedAt: null } },
        },
      });
      expect(communityModel.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: { ownerId: 'eligible-1' },
      });
      expect(memberModel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: 'OWNER' } }),
      );
    });

    it('winds a campus community up when nobody at its college is eligible', async () => {
      ownedBy({ id: 'camp-2', isCampusCommunity: true, collegeId: 'col-1' });
      campusHeirs({});
      await purge.runSweep();

      const updates = communityUpdates();
      expect(updates).toHaveLength(1);
      expect(updates[0].where).toEqual({ id: 'camp-2' });
      expect(updates[0].data).toMatchObject({ memberCount: 0, ownerId: null });
      expect(updates[0].data.deletedAt).toBeInstanceOf(Date);
    });

    it('keeps the plain longest-standing rule for a non-campus community', async () => {
      ownedBy({ id: 'plain-1', isCampusCommunity: false, collegeId: null });
      memberModel.findFirst.mockImplementation(() =>
        Promise.resolve({ userId: 'oldest-1' }),
      );
      await purge.runSweep();

      expect(memberModel.findFirst).toHaveBeenCalledWith({
        where: { communityId: 'plain-1', userId: { not: USER_ID } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        select: { userId: true },
      });
      expect(communityModel.update).toHaveBeenCalledWith({
        where: { id: 'plain-1' },
        data: { ownerId: 'oldest-1' },
      });
    });

    it('decrements a handed-over community once, at the final membership delete', async () => {
      ownedBy({ id: 'plain-2', isCampusCommunity: false, collegeId: null });
      memberModel.findFirst.mockImplementation(() =>
        Promise.resolve({ userId: 'heir-1' }),
      );
      await purge.runSweep();

      // The handover writes no count of its own and no per-community delete...
      expect(communityUpdates()).toEqual([
        { where: { id: 'plain-2' }, data: { ownerId: 'heir-1' } },
      ]);
      expect(calls['communityMember.deleteMany']).toHaveLength(1);
      // ...so the single statement before the user-wide delete is the only
      // decrement for it.
      const updates = sequence.filter((q) => q.includes('UPDATE "Community"'));
      expect(updates).toHaveLength(1);
    });

    it('does not decrement a community it winds up, which is soft-deleted with count 0', async () => {
      ownedBy({ id: 'solo-1', isCampusCommunity: false, collegeId: null });
      await purge.runSweep();

      expect(calls['communityMember.deleteMany']?.[0]?.[0]?.where).toEqual({
        communityId: 'solo-1',
      });
      expect(communityUpdates()[0].data).toMatchObject({ memberCount: 0 });
      // The wind-up deletes its members before the count statement runs, and
      // that statement skips a community with a `deletedAt`.
      const wind = sequence.findIndex((q) =>
        q.includes('"communityId":"solo-1"'),
      );
      const raw = sequence.findIndex((q) => q.includes('UPDATE "Community"'));
      expect(wind).toBeLessThan(raw);
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
