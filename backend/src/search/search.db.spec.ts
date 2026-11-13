import { randomUUID } from 'crypto';
import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import type { BlocksService } from '../users/blocks.service';
import type { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import {
  communitySearchSql,
  userSearchSql,
  type CommunitySearchRow,
  type UserSearchRow,
} from './search-ranking';
import { SearchService } from './search.service';

/**
 * Search against a real Postgres (E-6).
 *
 * The people and community searches each used to read the viewer's campus
 * themselves, after the service had already read it. They now take the
 * service's answer. The oracle is the query reading it itself: for viewers in
 * every campus state (none, active, revoked, a disabled, deleted or inactive
 * college, anonymous) both must return the same rows, scores and order.
 *
 * Also the recent-searches cap (SOC-30).
 *
 * Needs a disposable database with every migration applied, named in BOTH
 * `DATABASE_URL` and `SEARCH_TEST_DATABASE_URL`, on localhost. Skipped
 * otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.SEARCH_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('search (database)', () => {
  let prisma: PrismaService;
  let service: SearchService;

  const college = async (
    state: Partial<{
      isActive: boolean;
      status: 'APPROVED' | 'DISABLED';
      deletedAt: Date;
    }> = {},
  ) =>
    (
      await prisma.college.create({
        data: { name: `College ${randomUUID().slice(0, 6)}`, ...state },
      })
    ).id;

  const user = async (
    name: string,
    affiliation?: { collegeId: string; revoked?: boolean },
  ) => {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        username: `${name}_${id.slice(0, 6)}`,
        displayName: `${name} ${id.slice(0, 4)}`,
        email: `${id}@example.test`,
        bio: `likes ${name}`,
      },
    });
    if (affiliation) {
      await prisma.collegeAffiliation.create({
        data: {
          userId: id,
          collegeId: affiliation.collegeId,
          email: `${id}@uni.test`,
          emailNormalized: `${id}@uni.test`,
          method: 'CAMPUS_OTP',
          revokedAt: affiliation.revoked ? new Date() : null,
        },
      });
    }
    return id;
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new SearchService(
      prisma,
      stub<BlocksService>({ getExcludedUserIds: () => Promise.resolve([]) }),
      stub<ActivityAuthorizationService>({}),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('people and community search rank the same with the campus passed in', async () => {
    const [a, b, disabled, deleted, inactive] = await Promise.all([
      college(),
      college(),
      college({ status: 'DISABLED' }),
      college({ deletedAt: new Date() }),
      college({ isActive: false }),
    ]);
    // Twelve people called "sam", spread over two campuses, and follows.
    const sams: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      sams.push(
        await user(
          'sam',
          i % 3 === 2 ? undefined : { collegeId: i % 3 ? b : a },
        ),
      );
    }
    for (const name of ['sam club', 'sams on campus', 'sam society']) {
      for (const campus of [null, a, b]) {
        await prisma.community.create({
          data: {
            name: `${name} ${randomUUID().slice(0, 4)}`,
            slug: `c-${randomUUID().slice(0, 8)}`,
            isCampusCommunity: campus !== null,
            collegeId: campus,
            description: 'all about sam',
          },
        });
      }
    }

    const viewers: Array<[string, string | null]> = [
      ['no campus', await user('viewer')],
      ['active campus', await user('viewer', { collegeId: a })],
      ['revoked campus', await user('viewer', { collegeId: a, revoked: true })],
      ['disabled college', await user('viewer', { collegeId: disabled })],
      ['deleted college', await user('viewer', { collegeId: deleted })],
      ['inactive college', await user('viewer', { collegeId: inactive })],
      ['anonymous', null],
    ];
    // The viewers follow a few of them, and are followed back by some.
    for (const [, viewerId] of viewers) {
      if (!viewerId) continue;
      await prisma.follow.createMany({
        data: [
          { followerId: viewerId, followingId: sams[0] },
          { followerId: viewerId, followingId: sams[4] },
          { followerId: sams[4], followingId: viewerId },
          { followerId: sams[7], followingId: viewerId },
        ],
      });
    }

    for (const [label, viewerId] of viewers) {
      const known =
        (await service['resolveViewer'](viewerId ?? undefined)) ?? undefined;
      const excludedIds = viewerId ? [viewerId] : [];
      for (const includeBio of [true, false]) {
        const read = (knownViewer: typeof known) =>
          prisma.$queryRaw<UserSearchRow[]>(
            userSearchSql({
              query: 'sam',
              viewerId,
              knownViewer,
              excludedIds,
              includeBio,
              take: 15,
            }),
          );
        expect([label, await read(known)]).toEqual([
          label,
          await read(undefined),
        ]);
      }
      const communities = (knownViewer: typeof known) =>
        prisma.$queryRaw<CommunitySearchRow[]>(
          communitySearchSql({
            query: 'sam',
            viewerId,
            knownViewer,
            includeDescription: true,
            take: 15,
          }),
        );
      const passed = await communities(known);
      expect([label, passed]).toEqual([label, await communities(undefined)]);
      // A sanity check that the comparison is not vacuous: the active-campus
      // viewer sees campus A's communities and nobody sees campus B's.
      if (label === 'active campus') expect(passed.length).toBe(6);
      if (label === 'no campus') expect(passed.length).toBe(3);
    }
  });

  it('keeps each person’s newest 30 searches and shows the newest 15', async () => {
    const me = await user('searcher');
    let shown: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      shown = await service.addRecentSearch(me, `term ${i}`);
      // Distinct updatedAt per term, so "newest" is well defined.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(await prisma.recentSearch.count({ where: { userId: me } })).toBe(30);
    expect(shown).toEqual(
      Array.from({ length: 15 }, (_, i) => `term ${39 - i}`),
    );
    // Searching an older term again brings it to the top, and keeps 30.
    shown = await service.addRecentSearch(me, 'term 12');
    expect(shown[0]).toBe('term 12');
    expect(await prisma.recentSearch.count({ where: { userId: me } })).toBe(30);
    // Removing one shows the next older one instead of shrinking the list.
    const afterRemove = await service.removeRecentSearch(me, 'term 39');
    expect(afterRemove).toHaveLength(15);
  });
});
