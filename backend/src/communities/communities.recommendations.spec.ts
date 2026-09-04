import { CommunitiesService } from './communities.service';

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
  let service: CommunitiesService;
  let prisma: any;
  let findManyArgs: any[];

  const makePool = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      name: `Community ${i}`,
      memberCount: 100 - i,
      ownerId: 'someone',
    }));

  const setup = (rows: any[]) => {
    findManyArgs = [];
    prisma = {
      community: {
        findMany: jest.fn(async (args: any) => {
          findManyArgs.push(args);
          return rows;
        }),
      },
    };

    service = new CommunitiesService(
      prisma,
      { emit: jest.fn() } as any,
      { getClient: () => null } as any,
      {} as any,
      { refFor: () => null } as any,
      {
        getExcludedUserIds: async () => [],
        isBlocked: async () => false,
        filterBlockedUsers: async (_u: any, ids: any) => ids,
        injectBlockFilter: async (_u: any, w: any) => w,
        invalidateBlockCache: async () => {},
      } as any,
      { createNotification: async () => ({}) } as any,
      { createModeratorPromotion: () => null } as any,
    );
  };

  it('excludes joined communities in the query rather than after it', async () => {
    setup(makePool(10));

    await service.getCommunityRecommendations('me', 3);

    expect(prisma.community.findMany).toHaveBeenCalledTimes(1);
    const { where, orderBy } = findManyArgs[0];
    // The anti-join is what keeps the pool full: filtering in JS afterwards
    // would shrink the panel as the viewer joined more communities.
    expect(where.members).toEqual({ none: { userId: 'me' } });
    expect(where.deletedAt).toBeNull();
    // Campus communities are a separate, verification-gated surface.
    expect(where.isCampusCommunity).toBe(false);
    expect(orderBy).toEqual({ memberCount: 'desc' });
  });

  it('asks for a wider pool than it returns, so there is something to draw from', async () => {
    setup(makePool(40));

    const results = await service.getCommunityRecommendations('me', 3);

    expect(findManyArgs[0].take).toBeGreaterThan(3);
    expect(results).toHaveLength(3);
  });

  it('produces a different selection across requests', async () => {
    setup(makePool(40));

    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const picked = await service.getCommunityRecommendations('me', 3);
      seen.add(picked.map((c) => c.id).join(','));
    }

    expect(seen.size).toBeGreaterThan(1);
  });

  it('never repeats a community within one selection', async () => {
    setup(makePool(40));

    for (let i = 0; i < 20; i++) {
      const picked = await service.getCommunityRecommendations('me', 3);
      expect(new Set(picked.map((c) => c.id)).size).toBe(3);
    }
  });

  it('marks every suggestion as not joined, explicitly', async () => {
    setup(makePool(5));

    const [first] = await service.getCommunityRecommendations('me', 3);

    // True by construction — the query excluded members — but emitted anyway
    // so the payload is self-describing and no consumer has to infer
    // membership from a missing field.
    expect(first.isJoined).toBe(false);
    expect(first.userRole).toBeNull();
    expect(first.name).toMatch(/^Community /);
  });

  it('returns a short list rather than an empty one when few are eligible', async () => {
    setup(makePool(2));

    const results = await service.getCommunityRecommendations('me', 3);

    expect(results).toHaveLength(2);
  });

  it('returns nothing, and asks nothing, without a viewer', async () => {
    setup(makePool(10));

    expect(await service.getCommunityRecommendations('', 3)).toEqual([]);
    expect(prisma.community.findMany).not.toHaveBeenCalled();
  });
});
