import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { stub } from '../common/testing/stub';
import { affiliatedWith } from '../common/campus/testing/affiliation.fixture';
import type { AffiliationGateRow } from '../common/campus/campus-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';

/**
 * Holding a post id is not access to the post.
 *
 * getPostById checked a deleted community and blocks but not private
 * membership or campus eligibility, and every other single-post route
 * (like, comment, bookmark, vote, comment list, ETag meta) checked nothing
 * about the community at all. All of them now go through one rule:
 * canViewCommunity — the rule the feed and createPost already apply.
 */
/** Runs an interactive `$transaction` callback against the same fake client. */
const withTx = <P extends object>(p: P) =>
  Object.assign(p, {
    $transaction: jest.fn(<T>(fn: (tx: P) => Promise<T>): Promise<T> => fn(p)),
  });

describe('PostsService — single-post access', () => {
  const POST = 'post-1';
  const COMMENT = 'comment-1';
  const COMMUNITY = 'c1';
  const VIEWER = 'viewer';

  type CommunityRow = {
    id: string;
    deletedAt: Date | null;
    isPrivate: boolean;
    isCampusCommunity: boolean;
    collegeId: string | null;
    ownerId: string | null;
    members: Array<{ userId: string }>;
  };

  let community: CommunityRow | null;
  let affiliation: AffiliationGateRow | null;
  let postRow: Record<string, unknown>;
  let excluded: string[];

  const communityRow = (over: Partial<CommunityRow> = {}): CommunityRow => ({
    id: COMMUNITY,
    deletedAt: null,
    isPrivate: false,
    isCampusCommunity: false,
    collegeId: null,
    ownerId: 'owner',
    members: [],
    ...over,
  });

  const build = () => {
    const prisma = {
      post: {
        findUnique: jest.fn(() => Promise.resolve({ ...postRow, community })),
        findFirst: jest.fn(() =>
          Promise.resolve({
            ...postRow,
            community,
            pollOptions: [],
            pollVotes: [],
            author: { id: 'author', username: 'a', accountStatus: 'ACTIVE' },
          }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
      community: { findUnique: jest.fn(() => Promise.resolve(community)) },
      user: { findUnique: jest.fn(() => Promise.resolve(null)) },
      collegeAffiliation: {
        findUnique: jest.fn(() => Promise.resolve(affiliation)),
      },
      comment: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: COMMENT,
            postId: POST,
            authorId: 'commenter',
            isDeleted: false,
            likeCount: 0,
            post: { communityId: COMMUNITY },
          }),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(),
      },
      commentLike: { findMany: jest.fn(() => Promise.resolve([])) },
      postLike: { findUnique: jest.fn(() => Promise.resolve(null)) },
      postBookmark: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        upsert: jest.fn(() => Promise.resolve({})),
      },
      media: { findMany: jest.fn(() => Promise.resolve([])) },
      $queryRaw: jest.fn(() =>
        Promise.resolve([{ likeCount: 1, inserted: 1 }]),
      ),
      $transaction: jest.fn(),
    };
    const service = new PostsService(
      stub<PrismaService>(prisma),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        getExcludedUserIds: () => Promise.resolve(excluded),
        injectBlockFilter: <T extends object>(_u: string, w: T) =>
          Promise.resolve(w),
      }),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<RedisService>({
        withLock: <T>(_k: string, _t: number, fn: () => Promise<T>) => fn(),
      }),
      stub<MentionsService>({ sanitize: () => Promise.resolve([]) }),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>({
        canDeleteEach: (_u: string, items: unknown[]) =>
          Promise.resolve(items.map(() => false)),
      }),
    );
    return { service, prisma };
  };

  beforeEach(() => {
    community = communityRow({ isPrivate: true });
    affiliation = null;
    excluded = [];
    postRow = {
      id: POST,
      authorId: 'author',
      communityId: COMMUNITY,
      deletedAt: null,
      likeCount: 0,
      text: 'secret',
      pollOptions: [
        { id: 'o1', text: 'a', voteCount: 0, _count: { votes: 0 } },
      ],
    };
  });

  /** Each route that takes a post (or a comment on one) id. */
  const routes: Array<
    [string, (s: PostsService) => Promise<unknown>, string[]]
  > = [
    ['getPostById', (s) => s.getPostById(POST, VIEWER), []],
    ['getComments', (s) => s.getComments(POST, VIEWER), []],
    ['getPostMeta', (s) => s.getPostMeta(POST, VIEWER), []],
    ['likePost', (s) => s.likePost(POST, VIEWER), ['$queryRaw']],
    ['unlikePost', (s) => s.unlikePost(POST, VIEWER), ['$queryRaw']],
    ['addComment', (s) => s.addComment(POST, VIEWER, 'hi'), ['$transaction']],
    ['bookmarkPost', (s) => s.bookmarkPost(POST, VIEWER), []],
    [
      'voteInPoll',
      (s) => s.voteInPoll(POST, VIEWER, { optionId: 'o1' }),
      ['$transaction'],
    ],
    ['likeComment', (s) => s.likeComment(COMMENT, VIEWER), ['$queryRaw']],
    ['unlikeComment', (s) => s.unlikeComment(COMMENT, VIEWER), ['$queryRaw']],
  ];

  describe.each(routes)('%s', (_name, call, writes) => {
    const wrote = (prisma: ReturnType<typeof build>['prisma']) => {
      const all = [
        ...writes.map((w) => prisma[w as '$queryRaw' | '$transaction']),
        prisma.postBookmark.upsert,
        prisma.comment.create,
      ];
      return all.some((m) => m.mock.calls.length > 0);
    };

    it('refuses a non-member of a private community with a 404 and writes nothing', async () => {
      const { service, prisma } = build();
      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
      expect(wrote(prisma)).toBe(false);
    });

    it('refuses a deleted community', async () => {
      community = communityRow({ deletedAt: new Date() });
      const { service } = build();
      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses another college's campus community", async () => {
      community = communityRow({
        isCampusCommunity: true,
        collegeId: 'college-a',
      });
      affiliation = affiliatedWith('college-b');
      const { service } = build();
      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a viewer with no college affiliation at all', async () => {
      community = communityRow({
        isCampusCommunity: true,
        collegeId: 'college-a',
      });
      affiliation = null;
      const { service } = build();
      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('who gets through', () => {
    it('lets a member of the private community like the post', async () => {
      community = communityRow({
        isPrivate: true,
        members: [{ userId: VIEWER }],
      });
      const { service } = build();
      await expect(service.likePost(POST, VIEWER)).resolves.toMatchObject({
        success: true,
      });
    });

    it('lets the owner of the private community read the meta', async () => {
      community = communityRow({ isPrivate: true, ownerId: VIEWER });
      const { service } = build();
      await expect(service.getPostMeta(POST, VIEWER)).resolves.toHaveProperty(
        'updatedAt',
      );
    });

    it('lets anyone interact with a public, non-campus community post', async () => {
      community = communityRow();
      const { service } = build();
      await expect(service.likePost(POST, VIEWER)).resolves.toMatchObject({
        success: true,
      });
    });

    it('lets a same-college viewer into the campus community', async () => {
      community = communityRow({
        isCampusCommunity: true,
        collegeId: 'college-a',
      });
      affiliation = affiliatedWith('college-a');
      const { service } = build();
      await expect(service.likePost(POST, VIEWER)).resolves.toMatchObject({
        success: true,
      });
    });

    it('does not touch the community table for a profile post', async () => {
      postRow = { ...postRow, communityId: null };
      const { service, prisma } = build();
      await service.likePost(POST, VIEWER);
      expect(prisma.community.findUnique).not.toHaveBeenCalled();
    });

    it('does not leak the membership / owner columns in getPostById', async () => {
      community = communityRow({
        members: [{ userId: VIEWER }],
      });
      const { service } = build();
      const result = await service.getPostById(POST, VIEWER);
      expect(result.community).not.toBeNull();
      expect(result.community).not.toHaveProperty('members');
      expect(result.community).not.toHaveProperty('ownerId');
      expect(result.community).not.toHaveProperty('collegeId');
      expect(result.community).toHaveProperty('avatar');
    });
  });

  describe('the ETag short-circuit', () => {
    it('is not reachable for a post the viewer may not see', async () => {
      // The controller returns 304 as soon as getPostMeta yields an updatedAt.
      // getPostMeta must therefore throw rather than yield, or a stale
      // If-None-Match would confirm the post exists and is unchanged.
      const { service } = build();
      await expect(service.getPostMeta(POST, VIEWER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('still yields null for a post that does not exist', async () => {
      const { service, prisma } = build();
      prisma.post.findUnique.mockResolvedValueOnce(null as never);
      await expect(service.getPostMeta(POST, VIEWER)).resolves.toBeNull();
    });

    it('refuses a post whose author the viewer is blocked with', async () => {
      postRow = { ...postRow, communityId: null };
      excluded = ['author'];
      const { service } = build();
      await expect(service.getPostMeta(POST, VIEWER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('blocks (M-12)', () => {
    beforeEach(() => {
      postRow = { ...postRow, communityId: null };
    });

    it('refuses to like a comment whose author is blocked either way', async () => {
      excluded = ['commenter'];
      const { service, prisma } = build();
      prisma.post.findUnique.mockResolvedValue({
        ...postRow,
        communityId: null,
      } as never);
      await expect(service.likeComment(COMMENT, VIEWER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('refuses to like a comment under a post whose author is blocked', async () => {
      excluded = ['author'];
      const { service, prisma } = build();
      await expect(service.likeComment(COMMENT, VIEWER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('refuses to bookmark a blocked author’s post', async () => {
      excluded = ['author'];
      const { service, prisma } = build();
      await expect(service.bookmarkPost(POST, VIEWER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.postBookmark.upsert).not.toHaveBeenCalled();
    });

    it('refuses to reply to a blocked author’s comment', async () => {
      excluded = ['commenter'];
      const { service, prisma } = build();
      prisma.comment.findUnique.mockResolvedValue({
        id: COMMENT,
        postId: POST,
        authorId: 'commenter',
        isDeleted: false,
      } as never);
      await expect(
        service.addComment(POST, VIEWER, 'hello', COMMENT),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });
  });
});

/**
 * Page boundaries. The next page is strictly "after" its cursor, and the cursor
 * used to be taken from the look-ahead (limit+1) row that is popped and never
 * shown — so that row was skipped forever. Every list's cursor now comes from
 * the last row actually returned.
 */
describe('PostsService — pagination continuity', () => {
  type Row = { id: string; createdAt: Date };

  /** n rows, newest first. */
  const rows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `id-${String(n - i).padStart(3, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n - i)),
    }));

  /** Interprets the `(createdAt, id)` keyset filter every list builds. */
  const matchesCursor = (
    row: { createdAt: Date; id: string },
    where: Record<string, unknown> | undefined,
    dir: 'lt' | 'gt',
    idKey: string,
  ): boolean => {
    const or = where?.OR as Array<Record<string, unknown>> | undefined;
    if (!or) return true;
    return or.some((clause) => {
      const c = clause.createdAt as Date | Record<string, Date>;
      if (c instanceof Date) {
        const idCond = clause[idKey] as Record<string, string>;
        return (
          row.createdAt.getTime() === c.getTime() &&
          (dir === 'lt' ? row.id < idCond[dir] : row.id > idCond[dir])
        );
      }
      return dir === 'lt'
        ? row.createdAt.getTime() < c.lt.getTime()
        : row.createdAt.getTime() > c.gt.getTime();
    });
  };

  const baseDeps = (prisma: unknown) =>
    new PostsService(
      stub<PrismaService>(prisma as Parameters<typeof stub<PrismaService>>[0]),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        getExcludedUserIds: () => Promise.resolve([]),
        isBlocked: () => Promise.resolve(false),
        injectBlockFilter: <T extends object>(_u: string, w: T) =>
          Promise.resolve(w),
      }),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<RedisService>(),
      stub<MentionsService>(),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>({
        canDeleteEach: (_u: string, items: unknown[]) =>
          Promise.resolve(items.map(() => false)),
      }),
    );

  /** Walks every page; returns the ids seen in order. */
  const walk = async (
    page: (cursor?: string) => Promise<{ ids: string[]; next?: string | null }>,
  ) => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const { ids, next } = await page(cursor);
      seen.push(...ids);
      if (!next) break;
      cursor = next;
    }
    return seen;
  };

  it('user posts: pages join with no row lost or repeated', async () => {
    const all = rows(7);
    const prisma = {
      user: { findUnique: jest.fn(() => Promise.resolve({ id: 'target' })) },
      post: {
        findMany: jest.fn(
          (args: { take: number; where: Record<string, unknown> }) =>
            Promise.resolve(
              all
                .filter((r) => matchesCursor(r, args.where, 'lt', 'id'))
                .slice(0, args.take)
                .map((r) => ({
                  ...r,
                  authorId: 'target',
                  text: '',
                  author: null,
                  media: [],
                  pollOptions: [],
                })),
            ),
        ),
      },
      postLike: { findMany: jest.fn(() => Promise.resolve([])) },
      postBookmark: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const service = baseDeps(prisma);

    const seen = await walk(async (cursor) => {
      const res = await service.getUserPosts('viewer', 'target', 3, cursor);
      return { ids: res.posts.map((p) => p.id), next: res.nextCursor };
    });

    expect(seen).toEqual(all.map((r) => r.id));
  });

  it('bookmarks: pages join with no row lost or repeated', async () => {
    const all = rows(7);
    const prisma = {
      collegeAffiliation: { findUnique: jest.fn(() => Promise.resolve(null)) },
      postBookmark: {
        findMany: jest.fn(
          (args: { take: number; where: Record<string, unknown> }) =>
            Promise.resolve(
              all
                .filter((r) => matchesCursor(r, args.where, 'lt', 'postId'))
                .slice(0, args.take)
                .map((r) => ({
                  postId: r.id,
                  createdAt: r.createdAt,
                  post: {
                    id: r.id,
                    text: '',
                    authorId: 'a',
                    deletedAt: null,
                    author: null,
                    media: [],
                    pollOptions: [],
                  },
                })),
            ),
        ),
      },
      postLike: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const service = baseDeps(prisma);

    const seen = await walk(async (cursor) => {
      const res = await service.getBookmarks('viewer', 3, cursor);
      return { ids: res.posts.map((p) => p.id), next: res.nextCursor };
    });

    expect(seen).toEqual(all.map((r) => r.id));
  });

  it('bookmarks: asks for posts in communities the viewer can see only', async () => {
    const prisma = {
      collegeAffiliation: { findUnique: jest.fn(() => Promise.resolve(null)) },
      postBookmark: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    await baseDeps(prisma).getBookmarks('viewer', 3);
    const where = (
      prisma.postBookmark.findMany.mock.calls[0] as unknown as [
        { where: { post: { AND: Array<{ OR?: unknown[] }> } } },
      ]
    )[0].where;
    const visibility = where.post.AND[1];
    expect(JSON.stringify(visibility)).toContain('"deletedAt":null');
    expect(JSON.stringify(visibility)).toContain('"isPrivate":false');
    expect(JSON.stringify(visibility)).toContain('"members":{"some":');
  });

  it('comment roots: pages join with no root lost or repeated', async () => {
    // Oldest first, as the comment list is.
    const all = [...rows(7)].reverse().map((r) => ({
      ...r,
      postId: 'p1',
      parentId: null,
      authorId: 'a',
      text: 't',
      isDeleted: false,
      deletedByUser: false,
      removedByOwner: false,
      likeCount: 0,
      author: {
        id: 'a',
        username: 'a',
        accountStatus: 'ACTIVE',
        deletedAt: null,
      },
    }));
    const prisma = {
      post: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            communityId: null,
            authorId: 'author',
            community: null,
          }),
        ),
      },
      comment: {
        findMany: jest.fn(
          (args: {
            take?: number;
            where: Record<string, unknown> & { parentId?: unknown };
          }) => {
            if (args.where.parentId !== null) return Promise.resolve([]);
            return Promise.resolve(
              all
                .filter((r) => matchesCursor(r, args.where, 'gt', 'id'))
                .slice(0, args.take ?? all.length),
            );
          },
        ),
      },
      commentLike: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const service = baseDeps(prisma);

    const seen = await walk(async (cursor) => {
      const res = await service.getComments('p1', 'viewer', 3, cursor);
      return { ids: res.comments.map((c) => c.id), next: res.nextCursor };
    });

    expect(seen).toEqual(all.map((r) => r.id));
  });

  it('chronological feed: the cursor is the last row returned, not the look-ahead', async () => {
    const all = rows(4); // limit 3 -> 4 fetched, the 4th is the look-ahead
    const prisma = {
      collegeAffiliation: { findUnique: jest.fn(() => Promise.resolve(null)) },
      $queryRaw: jest.fn(() =>
        Promise.resolve(
          all.map((r) => ({
            ...r,
            authorId: 'a',
            communityId: null,
            text: '',
            media: [],
            pollOptions: [],
          })),
        ),
      ),
    };
    const res = await baseDeps(prisma).getChronologicalFeed('viewer', 3);

    expect(res.posts.map((p) => p.id)).toEqual([
      all[0].id,
      all[1].id,
      all[2].id,
    ]);
    expect(res.nextCursor).toBe(
      `${all[2].createdAt.toISOString()}|${all[2].id}`,
    );
  });
});

describe('PostsService — poll bounds (M-13)', () => {
  const build = () => {
    const prisma = {
      post: {
        create: jest.fn((args: { data: { text: string; authorId: string } }) =>
          Promise.resolve({
            id: 'p1',
            text: args.data.text,
            authorId: args.data.authorId,
            media: [],
          }),
        ),
      },
      pollOption: {
        createMany: jest.fn(() => Promise.resolve({ count: 2 })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    const service = new PostsService(
      stub<PrismaService>(withTx(prisma)),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>(),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<RedisService>(),
      stub<MentionsService>({ sanitize: () => Promise.resolve([]) }),
      stub<StorageService>(),
      stub<ContentDeletionAuthorizer>(),
    );
    return { service, prisma };
  };

  const create = (service: PostsService, options: unknown[]) =>
    service.createPost('u1', 'Q?', undefined, undefined, { options });

  it('refuses more than 10 options', async () => {
    const { service, prisma } = build();
    await expect(
      create(
        service,
        Array.from({ length: 11 }, (_, i) => `o${i}`),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('accepts exactly 10', async () => {
    const { service, prisma } = build();
    await create(
      service,
      Array.from({ length: 10 }, (_, i) => `o${i}`),
    );
    expect(prisma.post.create).toHaveBeenCalled();
  });

  it('refuses a poll with fewer than 2 real options', async () => {
    const { service, prisma } = build();
    await expect(create(service, ['only one', '   '])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('accepts 2', async () => {
    const { service, prisma } = build();
    await create(service, ['a', 'b']);
    expect(prisma.post.create).toHaveBeenCalled();
  });

  it('creates a post with no poll as before', async () => {
    const { service, prisma } = build();
    await service.createPost('u1', 'No poll');
    expect(prisma.post.create).toHaveBeenCalled();
  });
});
