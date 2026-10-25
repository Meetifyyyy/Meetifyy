import { PostsService } from './posts.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type {
  StorageService,
  StoredObjectCheck,
} from '../uploads/uploads.service';
import { PayloadTooLargeException } from '@nestjs/common';
import type { ContentDeletionAuthorizer } from './content-deletion.authorizer';

/**
 * Once the row is committed, nothing after it may surface as a thrown error.
 *
 * The idempotency interceptor releases the key when a handler throws, so a
 * failure in a post-commit side effect let the client's retry run the insert
 * a second time and create a duplicate. These cases pin that a failing side
 * effect still resolves with the created entity, which the interceptor then
 * stores and replays.
 */
describe('PostsService — post-commit side effects never fail the write', () => {
  const build = (storedCheck: StoredObjectCheck = { state: 'ok' }) => {
    /**
     * What the interactive transaction hands its callback. Distinct from
     * `prisma`, whose writes throw: anything createPost writes outside the
     * transaction would commit even when the transaction rolls back, which
     * is exactly the retry-duplicates bug these cases guard.
     */
    const mediaRows = [
      {
        id: 'm-a',
        objectKey: 'posts/a.jpg',
        order: 0,
        postId: 'p1',
        mimeType: 'image/jpeg',
        placeholder: null,
      },
      {
        id: 'm-b',
        objectKey: 'posts/b.jpg',
        order: 1,
        postId: 'p1',
        mimeType: 'image/jpeg',
        placeholder: null,
      },
    ];
    const tx = {
      post: {
        create: jest.fn((args: { data: { text: string; authorId: string } }) =>
          Promise.resolve({
            id: 'p1',
            text: args.data.text,
            authorId: args.data.authorId,
            communityId: null,
            author: null,
          }),
        ),
      },
      pollOption: {
        createMany: jest.fn(() => Promise.resolve({ count: 2 })),
        findMany: jest.fn(() =>
          Promise.resolve([
            { id: 'o1', text: 'A' },
            { id: 'o2', text: 'B' },
          ]),
        ),
      },
      media: {
        // A database sorts by `order`; so does this fake.
        findMany: jest.fn((_args: unknown) =>
          Promise.resolve([...mediaRows].sort((x, y) => x.order - y.order)),
        ),
      },
      $executeRaw: jest.fn((_sql: unknown) => Promise.resolve(2)),
    };
    const outsideTx = (name: string) =>
      jest.fn((): never => {
        throw new Error(`${name} used outside the transaction`);
      });
    let committed = false;
    const prisma = {
      post: {
        create: outsideTx('post.create'),
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'p1',
            authorId: 'owner',
            communityId: null,
            deletedAt: null,
          }),
        ),
        update: jest.fn(() => Promise.resolve({ id: 'p1' })),
      },
      pollOption: {
        createMany: outsideTx('pollOption.createMany'),
        findMany: outsideTx('pollOption.findMany'),
      },
      media: {
        // The pre-transaction ownership check: read only.
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'm-a',
              ownerId: 'u1',
              postId: null,
              objectKey: 'posts/a.jpg',
            },
            {
              id: 'm-b',
              ownerId: 'u1',
              postId: null,
              objectKey: 'posts/b.jpg',
            },
          ]),
        ),
      },
      $executeRaw: outsideTx('$executeRaw'),
      comment: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn((args: { data: { authorId: string; text: string } }) =>
          Promise.resolve({
            id: 'c1',
            postId: 'p1',
            parentId: null,
            authorId: args.data.authorId,
            text: args.data.text,
            likeCount: 0,
            author: { id: args.data.authorId, username: 'u' },
          }),
        ),
      },
      $transaction: jest.fn(
        async (
          arg: ((t: unknown) => Promise<unknown>) | Promise<unknown>[],
          _options?: unknown,
        ): Promise<unknown> => {
          if (Array.isArray(arg)) return Promise.all(arg);
          const result = await arg(tx);
          committed = true;
          return result;
        },
      ),
    };
    const createNotification = jest.fn((_dto: unknown): Promise<unknown> =>
      Promise.reject(new Error('notifications down')),
    );
    const createComment = jest.fn((): never => {
      throw new Error('factory blew up');
    });
    const emit = jest.fn(() => Promise.resolve());
    const service = new PostsService(
      stub<PrismaService>(prisma),
      stub<NotificationsService>({ createNotification }),
      stub<NotificationFactory>({
        createComment,
        createCommentReply: createComment,
      }),
      stub<BlocksService>({ getExcludedUserIds: () => Promise.resolve([]) }),
      stub<DomainEventService>({ emit }),
      stub<RedisService>(),
      stub<MentionsService>({ sanitize: () => Promise.resolve([]) }),
      stub<StorageService>({
        checkStoredObject: (): Promise<StoredObjectCheck> =>
          Promise.resolve(storedCheck),
      }),
      stub<ContentDeletionAuthorizer>(),
    );
    return {
      service,
      prisma,
      tx,
      emit,
      createComment,
      isCommitted: () => committed,
    };
  };

  it('createPost resolves with the post when hashtag indexing rejects', async () => {
    const h = build();
    h.service['saveHashtags'] = jest.fn(
      (_postId: string, _text: string): Promise<void> =>
        Promise.reject(new Error('hashtags down')),
    );
    await expect(
      h.service.createPost('u1', 'Which? #tea', undefined, undefined, {
        options: ['A', 'B'],
      }),
    ).resolves.toMatchObject({
      id: 'p1',
      pollOptions: [
        { id: 'o1', text: 'A' },
        { id: 'o2', text: 'B' },
      ],
    });
    expect(h.tx.post.create).toHaveBeenCalledTimes(1);
  });

  it('createPost writes the post and its poll in one transaction', async () => {
    // A poll write that fails rolls the post back with it, so the request
    // fails with nothing committed and a retry is safe.
    const h = build();
    h.tx.pollOption.createMany.mockImplementation(() =>
      Promise.reject(new Error('poll insert failed')),
    );
    await expect(
      h.service.createPost('u1', 'Which?', undefined, undefined, {
        options: ['A', 'B'],
      }),
    ).rejects.toThrow('poll insert failed');
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.isCommitted()).toBe(false);
  });

  it('createPost widens the transaction timeout for a high-latency database', async () => {
    const h = build();
    await h.service.createPost('u1', 'hi');
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15_000,
      maxWait: 5_000,
    });
  });

  it('createPost attaches media in one statement and returns it in request order', async () => {
    const h = build();
    const post = await h.service.createPost(
      'u1',
      'pics',
      undefined,
      undefined,
      undefined,
      undefined,
      ['/api/media/posts/a.jpg', '/api/media/posts/b.jpg'],
    );
    // One statement for postId + order, not one update per image.
    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = h.tx.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    // post id, then (id, order) per image in request order, then the author.
    expect(sql.values).toEqual(['p1', 'm-a', 0, 'm-b', 1, 'u1']);
    // Read after the attach, sorted by the stored order.
    expect(h.tx.media.findMany).toHaveBeenCalledWith({
      where: { postId: 'p1' },
      orderBy: { order: 'asc' },
    });
    expect(post.media.map((m) => [m.id, m.order, m.url])).toEqual([
      ['m-a', 0, '/api/media/posts/a.jpg'],
      ['m-b', 1, '/api/media/posts/b.jpg'],
    ]);
    expect(h.isCommitted()).toBe(true);
  });

  it('createPost refuses media storage measures over the post limit, before writing', async () => {
    const h = build({
      state: 'too_large',
      message: 'Video must be 25 MB or less',
    });
    await expect(
      h.service.createPost(
        'u1',
        'clip',
        undefined,
        undefined,
        undefined,
        undefined,
        ['/api/media/posts/a.jpg', '/api/media/posts/b.jpg'],
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(h.tx.$executeRaw).not.toHaveBeenCalled();
    expect(h.isCommitted()).toBe(false);
  });

  it('createPost rolls back when a media row was claimed by someone else', async () => {
    // The conditional UPDATE matched one row of two: a concurrent post took
    // the other. Nothing may commit, so the client's retry is safe.
    const h = build();
    h.tx.$executeRaw.mockImplementation(() => Promise.resolve(1));
    await expect(
      h.service.createPost(
        'u1',
        'pics',
        undefined,
        undefined,
        undefined,
        undefined,
        ['/api/media/posts/a.jpg', '/api/media/posts/b.jpg'],
      ),
    ).rejects.toThrow('already attached');
    expect(h.isCommitted()).toBe(false);
    expect(h.tx.media.findMany).not.toHaveBeenCalled();
    expect(h.prisma.post.create).not.toHaveBeenCalled();
  });

  it('createPost refuses media from outside the posts folder', async () => {
    // The caller owns it, but a verification document or chat upload is not
    // post media and would be deleted with the post.
    const h = build();
    await expect(
      h.service.createPost(
        'u1',
        'pics',
        undefined,
        undefined,
        undefined,
        undefined,
        ['/api/media/verification/doc.jpg'],
      ),
    ).rejects.toThrow('not valid');
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.prisma.media.findMany).not.toHaveBeenCalled();
  });

  it('addComment resolves with the comment when notifications throw', async () => {
    const h = build();
    await expect(h.service.addComment('p1', 'u1', 'hi')).resolves.toMatchObject(
      { id: 'c1', text: 'hi' },
    );
    expect(h.createComment).toHaveBeenCalled();
    expect(h.prisma.comment.create).toHaveBeenCalledTimes(1);
  });

  it('addComment still emits the realtime event when the notification factory throws', async () => {
    const h = build();
    await h.service.addComment('p1', 'u1', 'hi');
    expect(h.createComment).toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalledWith(
      'comment.created',
      expect.objectContaining({ commentId: 'c1', postId: 'p1' }),
    );
  });
});
