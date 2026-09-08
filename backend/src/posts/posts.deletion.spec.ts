import { NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { createStudentYearPolicyMock } from '../common/student-year/testing/student-year-policy.mock';

describe('PostsService — deletion lifecycle & data cleanup', () => {
  const POST_ID = 'post-123';
  const AUTHOR_ID = 'author-456';
  const COMMUNITY_ID = 'comm-789';

  let service: PostsService;
  let prisma: any;
  let storageService: any;
  let mediaCleanupService: any;
  let domainEventService: any;
  let authorizer: any;
  /** Every raw statement the service issued, in order. */
  let rawCalls: Array<{ sql: string; values: any[] }>;

  beforeEach(() => {
    rawCalls = [];
    prisma = {
      post: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === POST_ID) {
            return {
              id: POST_ID,
              authorId: AUTHOR_ID,
              communityId: COMMUNITY_ID,
              text: 'Hello world',
              deletedAt: null,
            };
          }
          return null;
        }),
        update: jest.fn(async ({ data }: any) => data),
      },
      comment: {
        findMany: jest.fn(async () => [{ id: 'c1' }, { id: 'c2' }]),
        updateMany: jest.fn(async ({ data }: any) => data),
      },
      postLike: { deleteMany: jest.fn(async () => ({ count: 5 })) },
      postBookmark: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      postShare: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      postHashtag: { deleteMany: jest.fn(async () => ({ count: 3 })) },
      mention: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      commentLike: { deleteMany: jest.fn(async () => ({ count: 4 })) },
      pollVote: { deleteMany: jest.fn(async () => ({ count: 10 })) },
      pollOption: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      media: {
        findMany: jest.fn(async () => [
          { objectKey: 'posts/uuid1.jpg' },
          { objectKey: 'posts/uuid2.webp' },
        ]),
        deleteMany: jest.fn(async () => ({ count: 2 })),
      },
      /**
       * Post deletion is now one statement, so this is where it lands.
       *
       * Captured as (sql, params) rather than stubbed blind: the assertions
       * below are about what that single statement actually does, and the whole
       * point of the change is that there is exactly one of them.
       */
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        rawCalls.push({ sql: strings.join('?'), values });
        return [
          { objectKey: 'posts/uuid1.jpg' },
          { objectKey: 'posts/uuid2.webp' },
        ];
      }),
      $transaction: jest.fn(async (fn: any) =>
        typeof fn === 'function' ? fn(prisma) : fn,
      ),
    };

    storageService = {
      delete: jest.fn(async () => true),
    };

    mediaCleanupService = {
      queueMediaDeletion: jest.fn(),
    };

    domainEventService = {
      emit: jest.fn(),
    };

    authorizer = {
      assertCanDelete: jest.fn(async () => 'author'),
    };

    service = new PostsService(
      prisma,
      { createNotification: jest.fn() } as any,
      {} as any,
      {} as any,
      domainEventService,
      {} as any,
      {} as any,
      storageService,
      authorizer,
      // First-year isolation — not what the deletion lifecycle is about.
      createStudentYearPolicyMock() as any,
      mediaCleanupService,
    );
  });

  it('performs the whole cleanup in a single database round trip', async () => {
    // This is the fix, stated as a test. It used to be thirteen awaited
    // queries inside an interactive transaction — thirteen network latencies,
    // in series, on a connection that cannot multiplex them. That, and not the
    // amount of data, is what made deletion feel slow.
    const result = await service.deletePost(POST_ID, AUTHOR_ID);
    expect(result).toEqual({ success: true });

    expect(rawCalls).toHaveLength(1);
    // A single statement is atomic on its own; the explicit BEGIN/COMMIT were
    // two further round trips guarding nothing.
    expect(prisma.$transaction).not.toHaveBeenCalled();

    // The whole endpoint, counted end to end. Two: the authorization read, and
    // the statement. Deletion latency is this number times the round trip to
    // Postgres, so it is the number worth pinning — it was sixteen.
    const dbCalls =
      prisma.post.findUnique.mock.calls.length + prisma.$queryRaw.mock.calls.length;
    expect(dbCalls).toBe(2);
  });

  it('reads only the columns authorization needs, not the whole row', async () => {
    // The post body was being fetched to decide who may delete it.
    await service.deletePost(POST_ID, AUTHOR_ID);
    const [{ select }] = prisma.post.findUnique.mock.calls[0];
    expect(select).toEqual({
      authorId: true,
      communityId: true,
      deletedAt: true,
      text: true,
    });
  });

  it('does no database work at all when the author deletes their own post beyond those two', async () => {
    // The authorizer settles `actorId === authorId` without a query, so the
    // common path must not have grown one.
    await service.deletePost(POST_ID, AUTHOR_ID);
    expect(authorizer.assertCanDelete).toHaveBeenCalledTimes(1);
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
    expect(prisma.media.findMany).not.toHaveBeenCalled();
  });

  it('still does every piece of cleanup the thirteen queries did', async () => {
    await service.deletePost(POST_ID, AUTHOR_ID);
    const { sql, values } = rawCalls[0];

    // 1. The post itself is soft-deleted, not removed.
    expect(sql).toMatch(/UPDATE "Post"\s+SET "deletedAt"/);

    // 2. Comments are scrubbed, not merely tombstoned: no original text or
    //    mentions survive in the database.
    expect(sql).toMatch(/UPDATE "Comment"/);
    expect(sql).toMatch(/"isDeleted" = true/);
    expect(sql).toMatch(/"text" = ''/);
    expect(sql).toMatch(/"mentions" = NULL/);
    expect(sql).toMatch(/"likeCount" = 0/);

    // 3. Disposable engagement relations. A database cascade cannot reach
    //    these, because Post is soft-deleted rather than deleted.
    for (const table of [
      'PostLike',
      'PostBookmark',
      'PostShare',
      'PostHashtag',
      'PollVote',
      'PollOption',
    ]) {
      expect(sql).toContain(`DELETE FROM "${table}"`);
    }

    // 4. Mentions of the post, and mentions made inside its comments.
    expect(sql).toMatch(/"sourceType" = 'POST'::"MentionSource"/);
    expect(sql).toMatch(/"sourceType" = 'COMMENT'::"MentionSource"/);

    // 5. Likes on those comments.
    expect(sql).toContain('DELETE FROM "CommentLike"');

    // 6. The comment ids come from the scrub's own RETURNING. That dependency
    //    is the only real ordering constraint in the statement, and taking the
    //    ids this way is what removes the separate read they used to need.
    expect(sql).toMatch(/RETURNING "id"/);
    expect(sql).toMatch(/IN \(SELECT "id" FROM scrubbed_comments\)/);

    // 7. Media keys come back for object-storage cleanup.
    expect(sql).toMatch(/SELECT "objectKey" FROM "Media"/);

    // Every parameter is bound, never interpolated — this statement is built
    // from a tagged template and must stay that way.
    expect(values).toContain(POST_ID);
    expect(values.some((v) => v instanceof Date)).toBe(true);
  });

  it('queues the returned media keys for durable object-storage cleanup', async () => {
    await service.deletePost(POST_ID, AUTHOR_ID);
    expect(mediaCleanupService.queueMediaDeletion).toHaveBeenCalledWith([
      'posts/uuid1.jpg',
      'posts/uuid2.webp',
    ]);

    // 7. Domain event emitted
    expect(domainEventService.emit).toHaveBeenCalledWith(
      'post.deleted',
      { postId: POST_ID, communityId: COMMUNITY_ID },
      [AUTHOR_ID],
    );
  });

  it('throws NotFoundException if post is not found', async () => {
    prisma.post.findUnique.mockResolvedValueOnce(null);
    await expect(service.deletePost('nonexistent', AUTHOR_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException if post was already deleted (idempotent)', async () => {
    prisma.post.findUnique.mockResolvedValueOnce({
      id: POST_ID,
      authorId: AUTHOR_ID,
      deletedAt: new Date(),
    });
    await expect(service.deletePost(POST_ID, AUTHOR_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
