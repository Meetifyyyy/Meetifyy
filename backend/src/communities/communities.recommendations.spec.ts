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

  describe('private communities', () => {
    /**
     * The text of the ranking query, whitespace collapsed. `$queryRaw` is a
     * tagged template, so it is called with the literal fragments first and the
     * interpolated values after; the fragments are what carry the SQL.
     */
    const rankingSql = (): string => {
      const call = queryRaw.mock.calls[0] as unknown as [readonly string[]];
      return call[0].join('?').replace(/\s+/g, ' ');
    };

    /** The body of one named CTE in the ranking query. */
    const cteBody = (name: string): string => {
      const sql = rankingSql();
      const start = sql.indexOf(`${name} AS (`);
      return sql.slice(start, sql.indexOf(' ), ', start) + 3);
    };

    // The SQL itself is not executed here, so these pin the guards' presence;
    // what they select is only provable against a real Postgres.
    it('selects isPrivate in the eligible set', async () => {
      setup(scoredPool(1));
      await service.getCommunityRecommendations('me', 3);

      expect(rankingSql()).toMatch(
        /eligible AS \( SELECT [^()]*c\."isPrivate" FROM "Community" c/,
      );
    });

    it('keeps private communities out of the friends arm', async () => {
      setup(scoredPool(1));
      await service.getCommunityRecommendations('me', 3);

      expect(rankingSql()).toMatch(
        /friends_arm AS \(.*JOIN eligible e ON e\."id" = fm\."id" WHERE e\."isPrivate" = false GROUP BY/,
      );
    });

    it.each([
      [
        'friendCount',
        'CASE WHEN e."isPrivate" THEN 0 ELSE COALESCE(fc."friendCount", 0) END AS "friendCount"',
      ],
      [
        'friendSampleName',
        'CASE WHEN e."isPrivate" THEN NULL ELSE fs."displayName" END AS "friendSampleName"',
      ],
      [
        'campusMemberCount',
        'CASE WHEN e."isPrivate" OR me."collegeId" IS NULL THEN 0 ELSE COALESCE(cc."campusMemberCount", 0) END AS "campusMemberCount"',
      ],
    ])('blanks %s for a private community', async (_column, blanked) => {
      setup(scoredPool(1));
      await service.getCommunityRecommendations('me', 3);

      expect(rankingSql()).toContain(blanked);
    });

    it.each([
      ['friend_rows', 'WHERE pr."isPrivate" = false )'],
      [
        'campus_counts',
        'WHERE pr."isPrivate" = false AND me."collegeId" IS NOT NULL GROUP BY',
      ],
    ])(
      'never reads the members of a private community in %s',
      async (cte, guard) => {
        setup(scoredPool(1));
        await service.getCommunityRecommendations('me', 3);

        expect(cteBody(cte)).toContain(guard);
      },
    );

    it("counts campus members by active affiliation in the viewer's college", async () => {
      setup(scoredPool(1));
      await service.getCommunityRecommendations('me', 3);

      expect(cteBody('campus_counts')).toContain(
        'JOIN "CollegeAffiliation" ca ON ca."collegeId" = me."collegeId" AND ca."revokedAt" IS NULL',
      );
    });
  });

  describe('per-candidate aggregates', () => {
    const rankingSql = (): string => {
      const call = queryRaw.mock.calls[0] as unknown as [readonly string[]];
      return call[0].join('?').replace(/\s+/g, ' ');
    };

    it.each([
      ['friend_counts', 'GROUP BY fr."id"'],
      ['friend_sample', 'DISTINCT ON (fr."id")'],
      ['campus_counts', 'GROUP BY cm."communityId"'],
      ['recent_posts', 'GROUP BY p."communityId"'],
    ])(
      'computes %s once as a grouped CTE and joins it to the pool',
      async (cte, grouping) => {
        setup(scoredPool(1));
        await service.getCommunityRecommendations('me', 3);

        expect(rankingSql()).toContain(`${cte} AS (`);
        expect(rankingSql()).toContain(grouping);
        // Joined by community id, not looked up per candidate.
        expect(rankingSql()).toMatch(
          new RegExp(`LEFT JOIN ${cte} \\w+ ON \\w+\\."id" = e\\."id"`),
        );
      },
    );

    it('has no correlated subquery in the signals select list', async () => {
      setup(scoredPool(1));
      await service.getCommunityRecommendations('me', 3);

      const signals = rankingSql()
        .split('signals AS (')[1]
        .split(') SELECT s."id"')[0];
      // The only subquery left is the interest match over the viewer's own
      // (in-memory) interests; no table is read per candidate.
      expect(signals).not.toMatch(
        /FROM "(CommunityMember|CollegeAffiliation|Post|Follow|User)"/,
      );
      expect(signals).not.toMatch(/FROM my_follows/);
      expect(signals).toContain('unnest(me."interests")');
    });

    it("reads the viewer's memberships once, by user, and the window's posts once", async () => {
      setup(scoredPool(1));
      await service.getCommunityRecommendations('me', 3);

      expect(rankingSql().match(/FROM "Post" p/g)).toHaveLength(1);
      expect(
        rankingSql().match(/FROM my_follows mf JOIN "CommunityMember"/g),
      ).toHaveLength(1);
      expect(rankingSql()).toContain(
        'my_communities AS ( SELECT cm."communityId" AS "id" FROM "CommunityMember" cm, me WHERE cm."userId" = me."id" )',
      );
    });

    it('keeps the scoring formula', async () => {
      setup(scoredPool(1));
      await service.getCommunityRecommendations('me', 3);

      const sql = rankingSql();
      for (const term of [
        '3.0 * ln(1 + s."friendCount")',
        'CASE WHEN s."interestMatch" THEN 2.0 ELSE 0 END',
        '1.0 * ln(1 + s."campusMemberCount")',
        '1.5 * ln(1 + s."recentPosts")',
        '0.4 * ln(1 + s."memberCount")',
        'CASE WHEN s."ageDays" < 14 THEN 0.5 ELSE 0 END',
        'ORDER BY "score" DESC, s."id"',
      ]) {
        expect(sql).toContain(term);
      }
    });
  });

  describe('private communities (response)', () => {
    it('still returns a private community, with no friend or campus signal', async () => {
      // The query hands back zero / NULL for a private row; the response keeps
      // every key and carries those values through.
      setup(scoredPool(1, { friendCount: 0, friendSampleName: null }));

      const [first] = await service.getCommunityRecommendations('me', 3);

      expect(first).toMatchObject({
        id: 'c0',
        friendCount: 0,
        friendSampleName: null,
        campusMemberCount: 0,
      });
      expect(first.reason).not.toBe('friends_joined');
    });
  });

  it('returns nothing without a viewer, and asks nothing', async () => {
    setup(scoredPool(5));

    expect(await service.getCommunityRecommendations('', 3)).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
