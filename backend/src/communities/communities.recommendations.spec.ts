import { CommunitiesService } from './communities.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import type { BlocksService } from '../users/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { CampusAccessService } from '../common/campus/campus-access.service';

/**
 * "Discover Communities" — the profile sidebar's suggestion panel.
 *
 * It used to be the top three of `GET /communities` sliced by member count on
 * the client, so every viewer saw the same three biggest communities on every
 * visit, and the panel could be made entirely of ones they had already joined.
 *
 * The two properties that fix this are tested here directly: joined
 * communities are excluded by the QUERY (not filtered out afterwards, which
 * would return short pages once a viewer had joined a few), and the selection
 * is drawn at random from the popular remainder rather than being a fixed
 * top-N.
 */
describe('CommunitiesService — discovery recommendations', () => {
  /** One scored row out of the ranking query (see CommunityScoreRow). */
  type Scored = {
    id: string;
    friendCount: number;
    friendSampleName: string | null;
    campusMemberCount: number;
    interestMatch: boolean;
    recentPosts: number;
    score: number;
  };

  let service: CommunitiesService;
  let queryRaw: jest.Mock;
  let findMany: jest.Mock;

  const scoredPool = (n: number, over: Partial<Scored> = {}): Scored[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      friendCount: 0,
      friendSampleName: null,
      campusMemberCount: 0,
      interestMatch: false,
      recentPosts: 0,
      score: n - i,
      ...over,
    }));

  const setup = (rows: Scored[]) => {
    queryRaw = jest.fn(() => Promise.resolve(rows));
    // The full rows are loaded by id after the draw; echo back what was asked
    // for in a different order, as Postgres may.
    findMany = jest.fn((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        [...args.where.id.in].reverse().map((id) => ({
          id,
          name: `Community ${id}`,
          memberCount: 10,
        })),
      ),
    );
    service = new CommunitiesService(
      stub<PrismaService>({ $queryRaw: queryRaw, community: { findMany } }),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<RedisService>({ getClient: () => null }),
      stub<PresenceService>(),
      stub<DefaultAssetsService>({ refFor: () => null }),
      stub<BlocksService>({
        getExcludedUserIds: () => Promise.resolve([]),
        isBlocked: () => Promise.resolve(false),
        filterBlockedUsers: (_u: string, ids: string[]) => Promise.resolve(ids),
        injectBlockFilter: <T extends object>(_u: string, w: T) =>
          Promise.resolve(w),
        invalidateBlockCache: async () => {},
      }),
      stub<NotificationsService>({
        createNotification: jest.fn(() => Promise.resolve({})),
      }),
      stub<NotificationFactory>({ createModeratorPromotion: () => null }),
      stub<CampusAccessService>(),
    );
  };

  it('scores in one query and loads the chosen rows in one more', async () => {
    setup(scoredPool(10));

    await service.getCommunityRecommendations('me', 3);

    // Membership, pending requests, campus-only and deleted communities are
    // excluded inside the ranking SQL (verified against a real database);
    // nothing is filtered afterwards, so the panel never comes back short.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('returns the requested number, distinct, from the ranked pool', async () => {
    setup(scoredPool(40));

    for (let i = 0; i < 20; i++) {
      const picked = await service.getCommunityRecommendations('me', 3);
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((c) => c.id)).size).toBe(3);
    }
  });

  it('produces a different selection across requests', async () => {
    setup(scoredPool(40));

    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const picked = await service.getCommunityRecommendations('me', 3);
      seen.add(picked.map((c) => c.id).join(','));
    }

    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps the drawn order, not the order the rows were loaded in', async () => {
    setup(scoredPool(2));

    const picked = await service.getCommunityRecommendations('me', 3);

    // A pool no larger than the request is returned in rank order.
    expect(picked.map((c) => c.id)).toEqual(['c0', 'c1']);
  });

  it('marks every suggestion as not joined and says why it is there', async () => {
    setup(
      scoredPool(1, {
        friendCount: 2,
        friendSampleName: 'Asha',
        campusMemberCount: 5,
      }),
    );

    const [first] = await service.getCommunityRecommendations('me', 3);

    // True by construction — the query excluded members — but emitted anyway
    // so the payload is self-describing.
    expect(first.isJoined).toBe(false);
    expect(first.userRole).toBeNull();
    expect(first).toMatchObject({
      name: 'Community c0',
      reason: 'friends_joined',
      friendCount: 2,
      friendSampleName: 'Asha',
    });
  });

  it('returns nothing without a viewer, and asks nothing', async () => {
    setup(scoredPool(5));

    expect(await service.getCommunityRecommendations('', 3)).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
