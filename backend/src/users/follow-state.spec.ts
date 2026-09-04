import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventService } from '../events/domain-event.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { RedisService } from '../redis/redis.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { BlocksService } from './blocks.service';
import { PresenceService } from '../presence/presence.service';
import { AcademicsService } from '../academics/academics.service';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { createBlocksServiceMock } from './testing/blocks.service.mock';
import { clearAuthSyncCache } from '../auth/auth.service';

// Only `clearAuthSyncCache` is imported from the auth module by the code under
// test, and it is a module-level function rather than an injectable, so it can
// only be observed by replacing it.
jest.mock('../auth/auth.service', () => ({
  clearAuthSyncCache: jest.fn(),
}));

const clearAuthSyncCacheMock = clearAuthSyncCache as jest.Mock;

/**
 * Follow state is a rendering input, and every bug this suite covers had the
 * same shape: some layer answered "not following" for a relationship that
 * exists in the database, and the UI believed it.
 *
 * So these tests assert the property directly — the reported state matches the
 * `Follow` rows — and, separately, that the cost of answering does not grow
 * with the page or with the size of the viewer's graph. The second half
 * matters because the original bug only became obvious past a hundred follows:
 * anything that reads follow state by fetching the viewer's following list and
 * checking membership is correct in a fixture and wrong in production, and a
 * test that only checks the returned booleans cannot tell the two apart.
 */
describe('Follow state', () => {
  let service: UsersService;
  let prisma: any;

  /** `Follow` rows the fake `prisma.follow.findMany` answers from. */
  let follows: { followerId: string; followingId: string }[] = [];

  const makeModule = async (blocks: { blockerId: string; blockedId: string }[] = []) => {
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn() },
      userSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      follow: {
        findMany: jest.fn(async ({ where, select }: any) => {
          const followerId = where.followerId;
          const ids: string[] = where.followingId?.in ?? [];
          return follows
            .filter((f) => f.followerId === followerId && ids.includes(f.followingId))
            .map((f) =>
              select?.followingId ? { followingId: f.followingId } : f,
            );
        }),
      },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: NotificationFactory, useValue: { createFollow: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: RedisService, useValue: { withLock: jest.fn(async (_k, _t, fn) => fn()) } },
        { provide: BlocksService, useValue: createBlocksServiceMock(blocks) },
        {
          provide: PresenceService,
          useValue: {
            getPresence: jest.fn(),
            getPresenceMany: jest.fn().mockResolvedValue(new Map()),
          },
        },
        AcademicsService,
        {
          provide: VerificationAccessService,
          useValue: { eligibleUserWhere: () => ({}), isEnforcementEnabled: () => true },
        },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    follows = [];
    await makeModule();
  });

  describe('getAllUsers', () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `u${i}`,
        username: `user${i}`,
        displayName: `User ${i}`,
        settings: { showOnlineStatus: true, whoCanSeeOnline: 'everyone' },
      }));

    it('reports isFollowing from the Follow table for every row', async () => {
      prisma.user.findMany.mockResolvedValue(page(4));
      follows = [
        { followerId: 'me', followingId: 'u1' },
        { followerId: 'me', followingId: 'u3' },
      ];

      const result = await service.getAllUsers(4, 0, 'me');

      expect(result.map((u: any) => u.isFollowing)).toEqual([
        false,
        true,
        false,
        true,
      ]);
    });

    it('answers the whole page with ONE follow query, not one per row', async () => {
      prisma.user.findMany.mockResolvedValue(page(50));
      await service.getAllUsers(50, 0, 'me');

      expect(prisma.follow.findMany).toHaveBeenCalledTimes(1);
    });

    it('scopes that query to the page, so its cost is independent of how many accounts the viewer follows', async () => {
      // The viewer follows 5,000 accounts; only one of them is on this page.
      follows = Array.from({ length: 5000 }, (_, i) => ({
        followerId: 'me',
        followingId: `other${i}`,
      }));
      follows.push({ followerId: 'me', followingId: 'u2' });
      prisma.user.findMany.mockResolvedValue(page(3));

      const result = await service.getAllUsers(3, 0, 'me');

      // The query asks about the three ids on the page and nothing else — it
      // never materialises the viewer's following list, so there is no limit
      // for a relationship to fall outside of.
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { followerId: 'me', followingId: { in: ['u0', 'u1', 'u2'] } },
        select: { followingId: true },
      });
      expect(result.map((u: any) => u.isFollowing)).toEqual([false, false, true]);
    });

    it('reports not-following, and asks nothing, for an anonymous caller', async () => {
      prisma.user.findMany.mockResolvedValue(page(2));

      const result = await service.getAllUsers(2, 0, undefined);

      expect(prisma.follow.findMany).not.toHaveBeenCalled();
      expect(result.every((u: any) => u.isFollowing === false)).toBe(true);
    });
  });

  describe('getCampusUsers', () => {
    it('carries follow state for the campus list', async () => {
      prisma.user.findUnique.mockResolvedValue({ collegeId: 'college-1' });
      prisma.user.findMany.mockResolvedValue([
        { id: 'a', username: 'ann' },
        { id: 'b', username: 'bob' },
      ]);
      follows = [{ followerId: 'viewer', followingId: 'b' }];

      const result = await service.getCampusUsers('viewer', 50, 0);

      expect(result).toEqual([
        expect.objectContaining({ id: 'a', isFollowing: false }),
        expect.objectContaining({ id: 'b', isFollowing: true }),
      ]);
      expect(prisma.follow.findMany).toHaveBeenCalledTimes(1);
    });

    it('omits follow state when called with a college id rather than a viewer', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([{ id: 'a', username: 'ann' }]);

      const result = await service.getCampusUsers('college-1', 50, 0);

      expect(prisma.follow.findMany).not.toHaveBeenCalled();
      expect(result[0].isFollowing).toBe(false);
    });
  });

  describe('followUser / unfollowUser', () => {
    const followRow = {
      targetId: 'target-id',
      targetUsername: 'sarthak',
      targetDisplayName: 'Sarthak',
      targetAvatar: null,
      followerUsername: 'me',
      followerDisplayName: 'Me',
      followerAvatar: null,
      isBlocked: false,
      newlyFollowed: true,
      targetFollowers: 42,
      targetFollowing: 10,
      currentFollowing: 101,
    };

    it('drops the cached auth bootstrap so the next /auth/sync cannot serve a pre-follow followingList', async () => {
      prisma.$queryRaw.mockResolvedValue([followRow]);

      await service.followUser('follower-id', 'sarthak');

      expect(clearAuthSyncCacheMock).toHaveBeenCalledWith('follower-id');
    });

    it('drops it on unfollow too', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          targetId: 'target-id',
          targetUsername: 'sarthak',
          unfollowed: true,
          targetFollowers: 41,
          targetFollowing: 10,
          currentFollowing: 100,
        },
      ]);

      await service.unfollowUser('follower-id', 'sarthak');

      expect(clearAuthSyncCacheMock).toHaveBeenCalledWith('follower-id');
    });

    it('leaves the cache alone when the follow was already there', async () => {
      // A repeat follow writes nothing (ON CONFLICT DO NOTHING), so there is
      // no cached snapshot to invalidate — and rapid repeat clicks should not
      // each cost every replica its bootstrap cache entry.
      prisma.$queryRaw.mockResolvedValue([{ ...followRow, newlyFollowed: false }]);

      await service.followUser('follower-id', 'sarthak');

      expect(clearAuthSyncCacheMock).not.toHaveBeenCalled();
    });

    it('still reports isFollowing: true for a repeat follow', async () => {
      // Idempotence matters for the debounced client: a coalesced burst can
      // re-send a follow that already exists, and the answer must be the state
      // of the relationship, not "nothing happened".
      prisma.$queryRaw.mockResolvedValue([{ ...followRow, newlyFollowed: false }]);

      const res = await service.followUser('follower-id', 'sarthak');

      expect(res.isFollowing).toBe(true);
    });
  });

  describe('getFollowRecommendations', () => {
    const row = {
      id: 'cand-1',
      username: 'ravi',
      displayName: 'Ravi',
      avatar: null,
      bio: null,
      isCampusRep: false,
      collegeId: 'college-1',
      collegeName: 'Example College',
      verificationStatus: 'VERIFIED',
      mutualCount: 3,
      followerCount: 12,
      sameCollege: true,
    };

    it('builds the list in a single database round-trip', async () => {
      prisma.$queryRaw.mockResolvedValue([row]);

      await service.getFollowRecommendations('me', 3);

      // One query for the pool, the mutual counts and the follower counts
      // together. The scoring inputs are joined in SQL rather than looked up
      // per candidate.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('marks every suggestion as not followed, explicitly', async () => {
      prisma.$queryRaw.mockResolvedValue([row]);

      const [first] = await service.getFollowRecommendations('me', 3);

      // Explicitly `false`, never absent: a consumer must be able to read the
      // field rather than infer follow state from its absence.
      expect(first.isFollowing).toBe(false);
      expect(first).toMatchObject({
        id: 'cand-1',
        username: 'ravi',
        mutualCount: 3,
        followersCount: 12,
        college: 'Example College',
        verified: true,
      });
    });

    it('falls back to the username when a candidate has no display name', async () => {
      prisma.$queryRaw.mockResolvedValue([{ ...row, displayName: null }]);

      const [first] = await service.getFollowRecommendations('me', 3);

      expect(first.displayName).toBe('ravi');
    });

    it('asks for a wider pool than it returns, and draws from it', async () => {
      const pool = Array.from({ length: 40 }, (_, i) => ({
        ...row,
        id: `cand-${i}`,
        username: `user${i}`,
      }));
      prisma.$queryRaw.mockResolvedValue(pool);

      const results = await service.getFollowRecommendations('me', 3);

      expect(results).toHaveLength(3);
      // Everything returned came out of the ranked pool — the randomisation
      // chooses among candidates that already earned their place, so variety
      // costs no relevance.
      const poolUsernames = new Set(pool.map((p) => p.username));
      for (const r of results) expect(poolUsernames.has(r.username)).toBe(true);
      expect(new Set(results.map((r) => r.username)).size).toBe(3);
    });

    it('produces a different selection across requests', async () => {
      const pool = Array.from({ length: 40 }, (_, i) => ({
        ...row,
        id: `cand-${i}`,
        username: `user${i}`,
      }));
      prisma.$queryRaw.mockResolvedValue(pool);

      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const picked = await service.getFollowRecommendations('me', 3);
        seen.add(picked.map((p) => p.username).join(','));
      }

      // A strict top-N of a deterministic ranking gave every viewer the same
      // three faces forever. That is the behaviour being replaced.
      expect(seen.size).toBeGreaterThan(1);
    });

    it('returns the whole pool when fewer candidates than asked for are eligible', async () => {
      prisma.$queryRaw.mockResolvedValue([row]);

      const results = await service.getFollowRecommendations('me', 3);

      // A short panel, not an empty one.
      expect(results).toHaveLength(1);
      expect(results[0].username).toBe('ravi');
    });

    it('returns nothing, and asks nothing, without a viewer', async () => {
      const result = await service.getFollowRecommendations('', 3);

      expect(result).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
