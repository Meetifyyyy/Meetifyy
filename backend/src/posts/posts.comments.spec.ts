import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { ContentDeletionAuthorizer } from './content-deletion.authorizer';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { MentionsService } from '../mentions/mentions.service';
import { StorageService } from '../uploads/uploads.service';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';

describe('PostsService — comments', () => {
  const POST = 'post-1';
  const AUTHOR = 'user-1';

  /** A comment row as the comment paths read it. */
  type CommentRow = {
    id: string;
    postId: string;
    parentId: string | null;
    authorId: string;
    text: string;
    isDeleted: boolean;
    likeCount: number;
    createdAt: Date;
    _count?: { replies: number };
  };

  let service: PostsService;
  let prisma: ReturnType<typeof makePrisma>;
  let comments: Record<string, CommentRow>;

  const comment = (id: string, over: Partial<CommentRow> = {}): CommentRow => ({
    id,
    postId: POST,
    parentId: null,
    authorId: AUTHOR,
    text: `c ${id}`,
    isDeleted: false,
    likeCount: 0,
    createdAt: new Date(),
    ...over,
  });

  const makePrisma = () => {
    const prisma = {
      post: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: POST,
            authorId: 'owner',
            deletedAt: null,
          }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
      comment: {
        findUnique: jest.fn(
          ({ where }: { where: { id: string } }): Promise<CommentRow | null> =>
            Promise.resolve(comments[where.id] ?? null),
        ),
        create: jest.fn(({ data }: { data: { authorId: string } }) =>
          Promise.resolve({
            ...comment('new'),
            ...data,
            author: { id: data.authorId, username: 'u' },
          }),
        ),
        update: jest.fn(({ data }: { data: Partial<CommentRow> }) =>
          Promise.resolve({ ...data }),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      commentLike: {
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown): Promise<unknown> =>
        Promise.resolve(fn(prisma)),
      ),
    };
    return prisma;
  };

  beforeEach(async () => {
    comments = {};
    prisma = makePrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        studentYearPolicyMockProvider(),
        PostsService,
        { provide: PrismaService, useValue: prisma },
        // Deletion permissions have their own suite
        // (posts.deletion-permissions.spec.ts). Here the author is always the
        // one deleting, so the authorizer answers 'author' and these cases stay
        // about what deletion does to the thread rather than who may do it.
        {
          provide: ContentDeletionAuthorizer,
          useValue: {
            assertCanDelete: jest.fn(() => Promise.resolve('author')),
          },
        },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn(() => Promise.resolve({})) },
        },
        {
          provide: NotificationFactory,
          useValue: { createComment: jest.fn(), createCommentReply: jest.fn() },
        },
        {
          provide: BlocksService,
          useValue: { getExcludedUserIds: jest.fn(() => Promise.resolve([])) },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: RedisService,
          useValue: {
            getClient: () => null,
            withLock: (_k: string, _t: number, fn: () => unknown) => fn(),
          },
        },
        {
          provide: MentionsService,
          useValue: {
            sanitize: jest.fn(() => Promise.resolve([])),
            persistAndNotify: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: { exists: jest.fn(() => Promise.resolve(true)) },
        },
      ],
    }).compile();

    service = module.get(PostsService);
  });

  describe('replying', () => {
    it('refuses a parent that belongs to a different post', async () => {
      // Accepted on trust before: the reply was stored against this post with a
      // parent it could never be rendered under, so the tree builder found no
      // parent and promoted it to a root on the wrong thread.
      comments['other'] = comment('other', { postId: 'post-2' });
      await expect(
        service.addComment(POST, AUTHOR, 'hi', 'other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a parent that does not exist', async () => {
      await expect(
        service.addComment(POST, AUTHOR, 'hi', 'ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to reply under a deleted comment', async () => {
      // Otherwise a tombstone gets resurrected as a visible placeholder.
      comments['gone'] = comment('gone', { isDeleted: true });
      await expect(
        service.addComment(POST, AUTHOR, 'hi', 'gone'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a live parent on the same post', async () => {
      comments['ok'] = comment('ok');
      await expect(
        service.addComment(POST, AUTHOR, 'hi', 'ok'),
      ).resolves.toBeDefined();
    });

    it('increments the post comment count by exactly one', async () => {
      await service.addComment(POST, AUTHOR, 'hi');
      expect(prisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { commentCount: { increment: 1 } } }),
      );
    });
  });

  describe('deleting', () => {
    const withReplies = (n: number) => {
      comments['c1'] = { ...comment('c1'), _count: { replies: n } };
      prisma.comment.findUnique = jest.fn(
        (_query: { where: { id: string } }): Promise<CommentRow | null> =>
          Promise.resolve(comments['c1']),
      );
    };

    it('decrements the count for a leaf, matching the increment on add', async () => {
      withReplies(0);
      await service.deleteComment('c1', AUTHOR);
      expect(prisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { commentCount: { decrement: 1 } } }),
      );
    });

    it('decrements the count for a comment that still has replies too', async () => {
      // This used to be skipped, so the count stayed permanently one too high
      // while the client decremented anyway — the number moved on screen and
      // then jumped back on the next refetch.
      withReplies(2);
      await service.deleteComment('c1', AUTHOR);
      expect(prisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { commentCount: { decrement: 1 } } }),
      );
    });

    it('scrubs the content but keeps the row', async () => {
      withReplies(1);
      await service.deleteComment('c1', AUTHOR);
      const { data } = prisma.comment.update.mock.calls[0][0];
      expect(data).toMatchObject({
        isDeleted: true,
        deletedByUser: true,
        text: '',
        likeCount: 0,
      });
    });
  });

  describe('tombstone pruning', () => {
    const prune = (rows: CommentRow[]) =>
      service['pruneEmptyTombstones'](rows).map((c) => c.id);

    it('drops a deleted leaf', () => {
      expect(prune([comment('a'), comment('b', { isDeleted: true })])).toEqual([
        'a',
      ]);
    });

    it('keeps a deleted comment that is holding replies up', () => {
      expect(
        prune([
          comment('a', { isDeleted: true }),
          comment('a1', { parentId: 'a' }),
        ]),
      ).toEqual(['a', 'a1']);
    });

    it('cascades once the last live descendant is gone', () => {
      const rows = [
        comment('a', { isDeleted: true }),
        comment('b', { parentId: 'a', isDeleted: true }),
      ];
      expect(prune(rows)).toEqual([]);
    });

    it('leaves a fully live thread untouched', () => {
      const rows = [comment('a'), comment('a1', { parentId: 'a' })];
      expect(prune(rows)).toEqual(['a', 'a1']);
    });
  });
});
