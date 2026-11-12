import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { UsersService } from './users.service';
import { FollowRequestsController } from './follow-requests.controller';
import { createBlocksServiceMock } from './testing/blocks.service.mock';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import type { RedisService } from '../redis/redis.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { clearAuthSyncCache } from '../auth/auth.service';

jest.mock('../auth/auth.service', () => ({ clearAuthSyncCache: jest.fn() }));
const clearAuthSyncCacheMock = clearAuthSyncCache as jest.Mock;

/**
 * Follow requests for private accounts.
 *
 * Raw-SQL assertions here read the statement text: they prove the SQL asks for
 * the right things, not that Postgres answers them correctly. Those semantics
 * are proven by running the statement against a real database.
 */

type Json = Record<string, unknown>;

const followRow = {
  targetId: 'target',
  targetUsername: 'sam',
  targetDisplayName: 'Sam',
  targetAvatar: null,
  followerUsername: 'me',
  followerDisplayName: 'Me',
  followerAvatar: null,
  isBlocked: false,
  newlyFollowed: false,
  requested: false,
  newlyRequested: false,
  targetFollowers: 42,
  targetFollowing: 10,
  currentFollowing: 101,
};

const unfollowRow = {
  targetId: 'target',
  targetUsername: 'sam',
  unfollowed: false,
  requestWithdrawn: false,
  targetFollowers: 41,
  targetFollowing: 10,
  currentFollowing: 100,
};

/** The statement text of the first `$queryRaw` call, interpolations removed. */
const sqlOf = (queryRaw: jest.Mock): string =>
  (queryRaw.mock.calls[0] as unknown as [string[]])[0].join('?');

function build(
  opts: {
    blocks?: { blockerId: string; blockedId: string }[];
    prisma?: Json;
    /** What `SET key 1 EX n NX` answers: 'OK' when claimed, null when held. */
    redisSet?: jest.Mock<Promise<'OK' | null>, unknown[]>;
  } = {},
) {
  const queryRaw = jest.fn<Promise<unknown[]>, unknown[]>();
  const queueAdd = jest.fn<Promise<unknown>, [string, unknown, unknown]>(() =>
    Promise.resolve(undefined),
  );
  const emit = jest.fn<Promise<void>, [string, unknown, unknown?]>(() =>
    Promise.resolve(),
  );
  const cancelOne = jest.fn<Promise<unknown>, [Json]>(() =>
    Promise.resolve(null),
  );
  const cancelAll = jest.fn<Promise<number>, [Json]>(() => Promise.resolve(0));
  const service = Object.create(UsersService.prototype) as UsersService;
  Object.assign(service, {
    prisma: stub<PrismaService>({
      $queryRaw: queryRaw,
      ...(opts.prisma as object),
    }),
    blocksService: createBlocksServiceMock(opts.blocks),
    notifQueue: stub<Queue>({ add: queueAdd }),
    domainEventService: stub<DomainEventService>({ emit }),
    notificationsService: stub<NotificationsService>({
      cancelNotificationByCriteria: cancelOne,
      cancelNotificationsByType: cancelAll,
      invalidatePrefsCache: () => Promise.resolve(),
    }),
    ...(opts.redisSet
      ? {
          redisService: stub<RedisService>({
            getClient: () =>
              stub<NonNullable<ReturnType<RedisService['getClient']>>>({
                set: opts.redisSet,
              }),
          }),
        }
      : {}),
    logger: { warn: jest.fn(), debug: jest.fn(), log: jest.fn() },
  });
  return { service, queryRaw, queueAdd, emit, cancelOne, cancelAll };
}

beforeEach(() => {
  clearAuthSyncCacheMock.mockClear();
});

describe('followUser and private accounts', () => {
  it('turns a follow of a private account into a request: no Follow, one notification job, no follow.created', async () => {
    const { service, queryRaw, queueAdd, emit } = build();
    queryRaw.mockResolvedValue([
      { ...followRow, requested: true, newlyRequested: true },
    ]);

    const res = await service.followUser('me-id', 'sam');

    expect(res).toMatchObject({
      success: true,
      isFollowing: false,
      requested: true,
      targetUser: { id: 'target', username: 'sam', followersCount: 42 },
      currentUserStats: { followingCount: 101 },
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith(
      'follow-request-notification',
      {
        requesterId: 'me-id',
        targetId: 'target',
        actor: { username: 'me', displayName: 'Me', avatar: null },
      },
      expect.objectContaining({
        removeOnComplete: true,
        removeOnFail: { count: 50 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      }),
    );
    expect(emit).not.toHaveBeenCalled();
    expect(clearAuthSyncCacheMock).not.toHaveBeenCalled();
  });

  describe('push throttle', () => {
    const newRequest = { ...followRow, requested: true, newlyRequested: true };
    const pushKey = 'follow-request:notified:me-id:target';

    it('claims one key per pair, for a day, only if it is not already held', async () => {
      const redisSet = jest.fn<Promise<'OK' | null>, unknown[]>(() =>
        Promise.resolve('OK'),
      );
      const { service, queryRaw, queueAdd } = build({ redisSet });
      queryRaw.mockResolvedValue([newRequest]);

      await service.followUser('me-id', 'sam');

      expect(redisSet).toHaveBeenCalledWith(pushKey, '1', 'EX', 86_400, 'NX');
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('sends nothing for a second request from the same pair inside the window', async () => {
      const redisSet = jest
        .fn<Promise<'OK' | null>, unknown[]>()
        .mockResolvedValueOnce('OK')
        .mockResolvedValueOnce(null);
      const { service, queryRaw, queueAdd } = build({ redisSet });
      queryRaw.mockResolvedValue([newRequest]);

      // follow -> unfollow -> follow: the row is new both times.
      await service.followUser('me-id', 'sam');
      const second = await service.followUser('me-id', 'sam');

      expect(second).toMatchObject({ isFollowing: false, requested: true });
      expect(redisSet).toHaveBeenCalledTimes(2);
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('does not touch Redis for a request that already existed', async () => {
      const redisSet = jest.fn<Promise<'OK' | null>, unknown[]>(() =>
        Promise.resolve('OK'),
      );
      const { service, queryRaw, queueAdd } = build({ redisSet });
      queryRaw.mockResolvedValue([{ ...newRequest, newlyRequested: false }]);

      await service.followUser('me-id', 'sam');

      expect(redisSet).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('fails open when Redis errors: the request still notifies, and the throttle failure is only debug-logged', async () => {
      const redisSet = jest.fn<Promise<'OK' | null>, unknown[]>(() =>
        Promise.reject(new Error('redis down')),
      );
      const { service, queryRaw, queueAdd } = build({ redisSet });
      queryRaw.mockResolvedValue([newRequest]);

      await expect(service.followUser('me-id', 'sam')).resolves.toMatchObject({
        requested: true,
      });

      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(service['logger'].debug).toHaveBeenCalledWith(
        expect.stringContaining('redis down'),
      );
      expect(service['logger'].warn).not.toHaveBeenCalled();
    });

    it('fails open when there is no Redis client at all', async () => {
      const { service, queryRaw, queueAdd } = build();
      queryRaw.mockResolvedValue([newRequest]);

      await service.followUser('me-id', 'sam');

      expect(queueAdd).toHaveBeenCalledTimes(1);
    });
  });

  it('does not notify again for a request that is already pending', async () => {
    const { service, queryRaw, queueAdd } = build();
    queryRaw.mockResolvedValue([
      { ...followRow, requested: true, newlyRequested: false },
    ]);

    const res = await service.followUser('me-id', 'sam');

    expect(res).toMatchObject({ isFollowing: false, requested: true });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('leaves an existing follower of a private account following: no request, no notification', async () => {
    const { service, queryRaw, queueAdd, emit } = build();
    // The CTE reports `requested: false` for someone who already follows.
    queryRaw.mockResolvedValue([followRow]);

    const res = await service.followUser('me-id', 'sam');

    expect(res).toMatchObject({ isFollowing: true, requested: false });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps the public path as it was, and says requested: false', async () => {
    const { service, queryRaw, queueAdd, emit } = build();
    queryRaw.mockResolvedValue([{ ...followRow, newlyFollowed: true }]);

    const res = await service.followUser('me-id', 'sam');

    expect(res).toMatchObject({ isFollowing: true, requested: false });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0][0]).toBe('follow-notification');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('follow.created', {
      followerId: 'me-id',
      followingId: 'target',
      followingUsername: 'sam',
      followerStats: { followingCount: 101 },
      targetStats: { followersCount: 42 },
    });
    expect(clearAuthSyncCacheMock).toHaveBeenCalledWith('me-id');
  });

  it('keeps the not-found, self and block refusals', async () => {
    const { service, queryRaw } = build();

    queryRaw.mockResolvedValue([]);
    await expect(service.followUser('me-id', 'ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    queryRaw.mockResolvedValue([{ ...followRow, targetId: 'me-id' }]);
    await expect(service.followUser('me-id', 'me')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    queryRaw.mockResolvedValue([{ ...followRow, isBlocked: true }]);
    await expect(service.followUser('me-id', 'sam')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('asks for the target privacy setting and writes the request in the same single statement', async () => {
    const { service, queryRaw } = build();
    queryRaw.mockResolvedValue([followRow]);

    await service.followUser('me-id', 'sam');

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(queryRaw);
    expect(sql).toContain('"privateProfile"');
    expect(sql).toContain('LEFT JOIN "UserSettings"');
    expect(sql).toContain('INSERT INTO "FollowRequest"');
    expect(sql).toContain('ON CONFLICT ("requesterId", "targetId") DO NOTHING');
    // The Follow insert is the branch a request replaces.
    expect(sql).toMatch(
      /INSERT INTO "Follow" [\s\S]*NOT EXISTS \(SELECT 1 FROM needs_request\)[\s\S]*INSERT INTO "FollowRequest"/,
    );
    // The existing guards are still part of the statement.
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain(`"accountStatus"::text = 'ACTIVE'`);
    expect(sql).toContain('FROM "Block" b');
  });
});

describe('unfollowUser and pending requests', () => {
  it('withdraws a pending request and removes the target notification for that pair', async () => {
    const { service, queryRaw, cancelOne } = build();
    queryRaw.mockResolvedValue([{ ...unfollowRow, requestWithdrawn: true }]);

    const res = await service.unfollowUser('me-id', 'sam');

    expect(res).toMatchObject({ success: true, isFollowing: false });
    expect(res.requested).toBe(false);
    expect(cancelOne).toHaveBeenCalledWith({
      recipientId: 'target',
      actorId: 'me-id',
      entityId: 'me-id',
      type: NotificationType.FOLLOW_REQUEST,
    });
    const sql = sqlOf(queryRaw);
    expect(sql).toContain('DELETE FROM "FollowRequest"');
    expect(sql).toContain('"requesterId" = ');
  });

  it('touches no notification when there was no request to withdraw', async () => {
    const { service, queryRaw, cancelOne } = build();
    queryRaw.mockResolvedValue([{ ...unfollowRow, unfollowed: true }]);

    const res = await service.unfollowUser('me-id', 'sam');

    expect(res.requested).toBe(false);
    expect(cancelOne).not.toHaveBeenCalled();
  });
});

describe('GET api/follow-requests (listFollowRequests)', () => {
  const requesterRow = (n: number) => ({
    requesterId: `r${n}`,
    createdAt: new Date(Date.UTC(2026, 10, 12, 10, 0, 10 - n)),
    requester: {
      id: `r${n}`,
      username: `user${n}`,
      displayName: `User ${n}`,
      avatar: null,
    },
  });

  const withRows = (
    rows: unknown[],
    total = rows.length,
    blocks: { blockerId: string; blockedId: string }[] = [],
  ) => {
    const findMany = jest.fn<Promise<unknown[]>, [Json]>(() =>
      Promise.resolve(rows),
    );
    const count = jest.fn<Promise<number>, [Json]>(() =>
      Promise.resolve(total),
    );
    const built = build({
      blocks,
      prisma: { followRequest: { findMany, count } },
    });
    return { ...built, findMany, count };
  };

  it('returns { user, createdAt } newest first, with the pending total', async () => {
    const { service, findMany } = withRows(
      [requesterRow(1), requesterRow(2)],
      7,
    );

    const res = await service.listFollowRequests('me-id', 20);

    expect(res.requests).toEqual([
      {
        user: {
          id: 'r1',
          username: 'user1',
          displayName: 'User 1',
          avatar: null,
        },
        createdAt: requesterRow(1).createdAt,
      },
      { user: requesterRow(2).requester, createdAt: requesterRow(2).createdAt },
    ]);
    expect(res.total).toBe(7);
    expect(res.nextCursor).toBeNull();
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { requesterId: 'desc' }],
    });
  });

  it('pages: one extra row decides nextCursor, which names the last row returned', async () => {
    const rows = [requesterRow(1), requesterRow(2), requesterRow(3)];
    const { service, findMany } = withRows(rows, 3);

    const res = await service.listFollowRequests('me-id', 2);

    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 3 });
    expect(res.requests.map((r) => r.user.id)).toEqual(['r1', 'r2']);
    expect(res.nextCursor).toBe(`${rows[1].createdAt.toISOString()}|r2`);
  });

  it('resumes strictly after the cursor row', async () => {
    const { service, findMany } = withRows([]);
    const at = new Date('2026-11-12T10:00:00.000Z');

    await service.listFollowRequests('me-id', 20, `${at.toISOString()}|r2`);

    const where = findMany.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND[1]).toEqual({
      OR: [
        { createdAt: { lt: at } },
        { createdAt: at, requesterId: { lt: 'r2' } },
      ],
    });
  });

  it('treats an unusable cursor as the first page rather than an error', async () => {
    const { service, findMany } = withRows([]);

    await service.listFollowRequests('me-id', 20, 'not-a-cursor');

    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('AND');
  });

  it('clamps the page size to 1..50', async () => {
    const { service, findMany } = withRows([]);

    await service.listFollowRequests('me-id', 5000);
    await service.listFollowRequests('me-id', -3);

    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 51 });
    expect(findMany.mock.calls[1][0]).toMatchObject({ take: 2 });
  });

  it('leaves out blocked and inactive requesters from the page and from the total alike', async () => {
    const { service, findMany, count } = withRows([], 0, [
      { blockerId: 'me-id', blockedId: 'enemy' },
      { blockerId: 'fan', blockedId: 'me-id' },
    ]);

    await service.listFollowRequests('me-id', 20);

    const expected = {
      targetId: 'me-id',
      requester: { deletedAt: null, accountStatus: 'ACTIVE' },
      requesterId: { notIn: ['enemy', 'fan'] },
    };
    expect(findMany.mock.calls[0][0].where).toEqual(expected);
    expect(count.mock.calls[0][0].where).toEqual(expected);
  });

  it('adds no block clause for someone who has blocked nobody', async () => {
    const { service, findMany } = withRows([]);

    await service.listFollowRequests('me-id', 20);

    expect(findMany.mock.calls[0][0].where).toEqual({
      targetId: 'me-id',
      requester: { deletedAt: null, accountStatus: 'ACTIVE' },
    });
  });
});

describe('FollowRequestsController', () => {
  const req = { user: { id: 'me-id' } } as AuthenticatedRequest;
  const makeController = () => {
    const listFollowRequests = jest.fn<
      Promise<unknown>,
      [string, number, string | undefined]
    >(() => Promise.resolve({}));
    const controller = new FollowRequestsController(
      stub<UsersService>({ listFollowRequests }),
    );
    return { controller, listFollowRequests };
  };

  it.each<[string | undefined, number]>([
    [undefined, 20],
    ['', 20],
    ['abc', 20],
    ['0', 1],
    ['-4', 1],
    ['7', 7],
    ['9999', 50],
  ])('limit=%s is served as %i', async (raw, expected) => {
    const { controller, listFollowRequests } = makeController();
    await controller.list(req, undefined, raw);
    expect(listFollowRequests).toHaveBeenCalledWith(
      'me-id',
      expected,
      undefined,
    );
  });

  it('takes the first value of a repeated ?cursor= instead of failing on an array', async () => {
    const { controller, listFollowRequests } = makeController();
    await controller.list(
      req,
      ['2026-11-12T10:00:00.000Z|a', 'b'] as unknown as string,
      undefined,
    );
    expect(listFollowRequests).toHaveBeenCalledWith(
      'me-id',
      20,
      '2026-11-12T10:00:00.000Z|a',
    );
  });
});

describe('accepting and declining a request', () => {
  const people = [
    {
      id: 'requester',
      username: 'rita',
      displayName: 'Rita',
      avatar: 'rita.png',
      deletedAt: null,
      accountStatus: 'ACTIVE',
    },
    {
      id: 'me-id',
      username: 'me',
      displayName: 'Me',
      avatar: null,
      deletedAt: null,
      accountStatus: 'ACTIVE',
    },
  ];

  const withTx = (claimed: number, users: unknown[] = people) => {
    const tx = {
      followRequest: {
        deleteMany: jest.fn<Promise<{ count: number }>, [Json]>(() =>
          Promise.resolve({ count: claimed }),
        ),
      },
      user: {
        findMany: jest.fn<Promise<unknown[]>, [Json]>(() =>
          Promise.resolve(users),
        ),
      },
      follow: {
        createMany: jest.fn<Promise<{ count: number }>, [Json]>(() =>
          Promise.resolve({ count: 1 }),
        ),
      },
    };
    const followCount = jest.fn<Promise<number>, [{ where: Json }]>(
      ({ where }) => Promise.resolve('followingId' in where ? 5 : 12),
    );
    const requestDeleteMany = jest.fn<Promise<{ count: number }>, [Json]>(() =>
      Promise.resolve({ count: claimed }),
    );
    const built = build({
      prisma: {
        $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) =>
          fn(tx),
        ),
        follow: { count: followCount },
        followRequest: { deleteMany: requestDeleteMany },
      },
    });
    return { ...built, tx, followCount, requestDeleteMany };
  };

  it('accept: creates the follow, consumes the request, notifies the requester and emits follow.created once', async () => {
    const { service, tx, queueAdd, emit, cancelOne } = withTx(1);

    const res = await service.acceptFollowRequest('me-id', 'requester');

    expect(res).toEqual({ success: true, followersCount: 5 });
    expect(tx.followRequest.deleteMany).toHaveBeenCalledWith({
      where: { requesterId: 'requester', targetId: 'me-id' },
    });
    // ON CONFLICT DO NOTHING: an edge that already exists is not an error.
    expect(tx.follow.createMany).toHaveBeenCalledWith({
      data: [{ followerId: 'requester', followingId: 'me-id' }],
      skipDuplicates: true,
    });

    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith(
      'follow-accepted-notification',
      {
        accepterId: 'me-id',
        requesterId: 'requester',
        actor: { username: 'me', displayName: 'Me', avatar: null },
      },
      expect.objectContaining({ attempts: 3, removeOnComplete: true }),
    );

    // Same payload shape followUser emits, for the REQUESTER's new edge.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('follow.created', {
      followerId: 'requester',
      followingId: 'me-id',
      followingUsername: 'me',
      followerStats: { followingCount: 12 },
      targetStats: { followersCount: 5 },
    });
    expect(clearAuthSyncCacheMock).toHaveBeenCalledWith('requester');

    expect(cancelOne).toHaveBeenCalledWith({
      recipientId: 'me-id',
      actorId: 'requester',
      entityId: 'requester',
      type: NotificationType.FOLLOW_REQUEST,
    });
  });

  it('accept: 404 and no side effects when there is no such request', async () => {
    const { service, tx, queueAdd, emit, cancelOne } = withTx(0);

    await expect(
      service.acceptFollowRequest('me-id', 'requester'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.follow.createMany).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(cancelOne).not.toHaveBeenCalled();
  });

  it('accept: refuses a requester who is no longer an active account', async () => {
    const { service, tx, queueAdd, emit } = withTx(1, [
      { ...people[0], accountStatus: 'SUSPENDED' },
      people[1],
    ]);

    await expect(
      service.acceptFollowRequest('me-id', 'requester'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Thrown inside the transaction, so the claim on the request rolls back.
    expect(tx.follow.createMany).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('decline: deletes the request and its notification, and tells the requester nothing', async () => {
    const { service, requestDeleteMany, queueAdd, emit, cancelOne } = withTx(1);

    const res = await service.declineFollowRequest('me-id', 'requester');

    expect(res).toEqual({ success: true });
    expect(requestDeleteMany).toHaveBeenCalledWith({
      where: { requesterId: 'requester', targetId: 'me-id' },
    });
    expect(cancelOne).toHaveBeenCalledWith({
      recipientId: 'me-id',
      actorId: 'requester',
      entityId: 'requester',
      type: NotificationType.FOLLOW_REQUEST,
    });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('decline: 404 when there is no such request', async () => {
    const { service, cancelOne } = withTx(0);

    await expect(
      service.declineFollowRequest('me-id', 'requester'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(cancelOne).not.toHaveBeenCalled();
  });
});

describe('updateSettings and pending requests', () => {
  const withSettings = (dropped: number) => {
    const settingsRow = { userId: 'me-id', privateProfile: false };
    const upsert = jest.fn<Promise<unknown>, [Json]>(() =>
      Promise.resolve(settingsRow),
    );
    const deleteMany = jest.fn<Promise<{ count: number }>, [Json]>(() =>
      Promise.resolve({ count: dropped }),
    );
    const tx = { userSettings: { upsert }, followRequest: { deleteMany } };
    const $transaction = jest.fn((fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    );
    const outsideUpsert = jest.fn<Promise<unknown>, [Json]>(() =>
      Promise.resolve(settingsRow),
    );
    const built = build({
      prisma: {
        $transaction,
        userSettings: { upsert: outsideUpsert },
      },
    });
    return { ...built, upsert, deleteMany, $transaction, outsideUpsert };
  };

  it('discards every pending request, and their notifications, when the account goes public', async () => {
    const { service, upsert, deleteMany, cancelAll, queueAdd, outsideUpsert } =
      withSettings(3);

    await service.updateSettings('me-id', { privateProfile: false });

    // Same transaction as the settings write.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(outsideUpsert).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({ where: { targetId: 'me-id' } });
    expect(cancelAll).toHaveBeenCalledWith({
      recipientId: 'me-id',
      type: NotificationType.FOLLOW_REQUEST,
    });
    // Discarded, not answered: nobody is notified.
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('does not go looking for notifications when there were no requests', async () => {
    const { service, cancelAll } = withSettings(0);

    await service.updateSettings('me-id', { privateProfile: false });

    expect(cancelAll).not.toHaveBeenCalled();
  });

  it('keeps pending requests when the account stays or turns private', async () => {
    const { service, deleteMany, $transaction, outsideUpsert, cancelAll } =
      withSettings(3);

    await service.updateSettings('me-id', { privateProfile: true });

    expect(deleteMany).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
    expect(outsideUpsert).toHaveBeenCalledTimes(1);
    expect(cancelAll).not.toHaveBeenCalled();
  });

  it('leaves requests alone for a settings write that does not mention privacy', async () => {
    const { service, deleteMany, $transaction } = withSettings(3);

    await service.updateSettings('me-id', { readReceipts: false });

    expect(deleteMany).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('getProfileByUsername followRequested', () => {
  const targetRow = (privateProfile: boolean) => ({
    id: 'target',
    username: 'sam',
    displayName: 'Sam',
    avatar: null,
    cover: null,
    bio: null,
    birthday: null,
    college: null,
    collegeId: null,
    isCampusRep: false,
    course: null,
    branch: null,
    passingYear: null,
    location: null,
    interests: [],
    verificationStatus: 'UNVERIFIED',
    profileCompleted: true,
    createdAt: new Date('2026-01-01'),
    deletedAt: null,
    settings: {
      privateProfile,
      showOnlineStatus: true,
      whoCanSeeOnline: 'nobody',
    },
    _count: { followers: 0, following: 0, posts: 0 },
  });

  const setup = (
    privateProfile: boolean,
    opts: { pending?: boolean; following?: boolean } = {},
  ) => {
    const requestFind = jest.fn<Promise<unknown>, [Json]>(() =>
      Promise.resolve(opts.pending ? { requesterId: 'viewer' } : null),
    );
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      prisma: stub<PrismaService>({
        user: {
          findFirst: jest.fn(() => Promise.resolve(targetRow(privateProfile))),
        },
        follow: {
          // First lookup is viewer -> target, the second target -> viewer.
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(
              opts.following ? { followerId: 'viewer' } : null,
            )
            .mockResolvedValueOnce(null),
        },
        followRequest: { findUnique: requestFind },
        userSettings: { findUnique: () => Promise.resolve(null) },
      }),
      blocksService: createBlocksServiceMock(),
      presenceService: stub<PresenceService>({
        getPresence: () => Promise.resolve(null),
      }),
    });
    return { service, requestFind };
  };

  it('is true when the viewer has a pending request to a private account', async () => {
    const { service, requestFind } = setup(true, { pending: true });

    const profile = await service.getProfileByUsername('sam', 'viewer');

    expect(profile.followRequested).toBe(true);
    expect(profile.isFollowing).toBe(false);
    expect(requestFind).toHaveBeenCalledWith({
      where: {
        requesterId_targetId: { requesterId: 'viewer', targetId: 'target' },
      },
      select: { requesterId: true },
    });
  });

  it('is false for a private account the viewer has not asked', async () => {
    const { service } = setup(true);
    expect(
      (await service.getProfileByUsername('sam', 'viewer')).followRequested,
    ).toBe(false);
  });

  it('is never true alongside isFollowing', async () => {
    const { service } = setup(true, { pending: true, following: true });
    const profile = await service.getProfileByUsername('sam', 'viewer');
    expect(profile.isFollowing).toBe(true);
    expect(profile.followRequested).toBe(false);
  });

  it('is false, and costs no query, for a public profile', async () => {
    const { service, requestFind } = setup(false, { pending: true });

    const profile = await service.getProfileByUsername('sam', 'viewer');

    expect(profile.followRequested).toBe(false);
    expect(requestFind).not.toHaveBeenCalled();
  });

  it('is false, and costs no query, for the owner and for an anonymous viewer', async () => {
    const own = setup(true, { pending: true });
    expect(
      (await own.service.getProfileByUsername('sam', 'target')).followRequested,
    ).toBe(false);
    expect(own.requestFind).not.toHaveBeenCalled();

    const anon = setup(true, { pending: true });
    expect(
      (await anon.service.getProfileByUsername('sam')).followRequested,
    ).toBe(false);
    expect(anon.requestFind).not.toHaveBeenCalled();
  });
});
