import { SearchService } from './search.service';
import { stub } from '../common/testing/stub';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';
import type { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { BlocksService } from '../users/blocks.service';

/**
 * Post search: which community posts a searcher may be shown, and that paging
 * through the results loses nothing.
 */
describe('SearchService — post search scope and paging', () => {
  type PostRow = { id: string; createdAt: Date };

  const rows = (n: number): PostRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `p-${String(n - i).padStart(3, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n - i)),
    }));

  type FindManyArgs = {
    take: number;
    where: { AND: Array<Record<string, unknown>> } & Record<string, unknown>;
  };

  const build = (all: PostRow[], viewerCollege: string | null = null) => {
    const findMany = jest.fn((args: FindManyArgs) => {
      // The keyset clause is the AND entry that constrains createdAt.
      const cursorClause = args.where.AND.find((c) => {
        const or = c.OR as Array<Record<string, unknown>> | undefined;
        return or?.some((o) => 'createdAt' in o);
      })?.OR as Array<Record<string, unknown>> | undefined;
      const visible = all.filter((r) => {
        if (!cursorClause) return true;
        return cursorClause.some((clause) => {
          const c = clause.createdAt as Date | { lt: Date };
          if (c instanceof Date) {
            return (
              r.createdAt.getTime() === c.getTime() &&
              r.id < (clause.id as { lt: string }).lt
            );
          }
          return r.createdAt.getTime() < c.lt.getTime();
        });
      });
      return Promise.resolve(
        visible.slice(0, args.take).map((r) => ({
          ...r,
          text: 'hello',
          likeCount: 0,
          commentCount: 0,
          author: null,
          media: [],
          pollOptions: [],
        })),
      );
    });
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'viewer',
            collegeAffiliation: affiliatedWith(viewerCollege),
          }),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      post: { findMany },
      postLike: { findMany: jest.fn(() => Promise.resolve([])) },
      postBookmark: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const service = new SearchService(
      stub<PrismaService>(prisma),
      stub<BlocksService>({ getExcludedUserIds: () => Promise.resolve([]) }),
      stub<ActivityAuthorizationService>({
        discoveryWhere: () => ({}),
      }),
    );
    return { service, findMany };
  };

  it('pages join with no post lost or repeated', async () => {
    const all = rows(7);
    const { service } = build(all);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const res = await service.globalSearch(
        'hello',
        'viewer',
        3,
        'posts',
        cursor,
      );
      seen.push(...res.posts.map((p) => p.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(seen).toEqual(all.map((r) => r.id));
  });

  it('only searches live communities, scoped to the viewer’s college', async () => {
    const { service, findMany } = build(rows(1), 'college-a');
    await service.globalSearch('hello', 'viewer', 3, 'posts');

    const where = findMany.mock.calls[0][0].where;
    const communityClause = JSON.stringify(where.AND[0]);

    // Deleted communities are excluded for both the public and member branches.
    expect(communityClause.match(/"deletedAt":null/g)).toHaveLength(2);
    // Campus communities of other colleges are excluded; the viewer's own stays.
    expect(communityClause).toContain('"isCampusCommunity":false');
    expect(communityClause).toContain('"collegeId":null');
    expect(communityClause).toContain('"collegeId":"college-a"');
  });

  it('offers a viewer with no college no campus community at all', async () => {
    const { service, findMany } = build(rows(1), null);
    await service.globalSearch('hello', 'viewer', 3, 'posts');

    const communityClause = JSON.stringify(
      findMany.mock.calls[0][0].where.AND[0],
    );
    expect(communityClause).not.toContain('college-');
    expect(communityClause).toContain('"isCampusCommunity":false');
  });

  it('shows only posts from available, active authors', async () => {
    const { service, findMany } = build(rows(1));
    await service.globalSearch('hello', 'viewer', 3, 'posts');

    expect(findMany.mock.calls[0][0].where.author).toEqual({
      deletedAt: null,
      accountStatus: 'ACTIVE',
    });
  });
});
