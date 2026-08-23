import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { MentionsService } from '../mentions/mentions.service';
import { StorageService } from '../uploads/uploads.service';

describe('PostsService — comments', () => {
  const POST = 'post-1';
  const AUTHOR = 'user-1';

  let service: PostsService;
  let prisma: any;
  let comments: Record<string, any>;

  const comment = (id: string, over: any = {}) => ({
    id, postId: POST, parentId: null, authorId: AUTHOR, text: `c ${id}`,
    isDeleted: false, likeCount: 0, createdAt: new Date(), ...over,
  });

  beforeEach(async () => {
    comments = {};
    prisma = {
      post: {
        findUnique: jest.fn(async () => ({ id: POST, authorId: 'owner', deletedAt: null })),
        update: jest.fn(async () => ({})),
      },
      comment: {
        findUnique: jest.fn(async ({ where }: any) => comments[where.id] ?? null),
        create: jest.fn(async ({ data }: any) => ({ ...comment('new'), ...data, author: { id: data.authorId, username: 'u' } })),
        update: jest.fn(async ({ data }: any) => ({ ...data })),
        findMany: jest.fn(async () => []),
      },
      commentLike: { deleteMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn(async () => ({})) } },
        { provide: NotificationFactory, useValue: { createComment: jest.fn(), createCommentReply: jest.fn() } },
        { provide: BlocksService, useValue: { getExcludedUserIds: jest.fn(async () => []) } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null, withLock: (_k: string, _t: number, fn: any) => fn() } },
        { provide: MentionsService, useValue: { sanitize: jest.fn(async () => []), persistAndNotify: jest.fn() } },
        { provide: StorageService, useValue: { exists: jest.fn(async () => true) } },
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
      await expect(service.addComment(POST, AUTHOR, 'hi', 'other')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a parent that does not exist', async () => {
      await expect(service.addComment(POST, AUTHOR, 'hi', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to reply under a deleted comment', async () => {
      // Otherwise a tombstone gets resurrected as a visible placeholder.
      comments['gone'] = comment('gone', { isDeleted: true });
      await expect(service.addComment(POST, AUTHOR, 'hi', 'gone')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a live parent on the same post', async () => {
      comments['ok'] = comment('ok');
      await expect(service.addComment(POST, AUTHOR, 'hi', 'ok')).resolves.toBeDefined();
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
      prisma.comment.findUnique = jest.fn(async () => comments['c1']);
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
      expect(data).toMatchObject({ isDeleted: true, deletedByUser: true, text: '', likeCount: 0 });
    });
  });

  describe('tombstone pruning', () => {
    const prune = (rows: any[]) => (service as any).pruneEmptyTombstones(rows).map((c: any) => c.id);

    it('drops a deleted leaf', () => {
      expect(prune([comment('a'), comment('b', { isDeleted: true })])).toEqual(['a']);
    });

    it('keeps a deleted comment that is holding replies up', () => {
      expect(prune([comment('a', { isDeleted: true }), comment('a1', { parentId: 'a' })])).toEqual(['a', 'a1']);
    });

    it('cascades once the last live descendant is gone', () => {
      const rows = [comment('a', { isDeleted: true }), comment('b', { parentId: 'a', isDeleted: true })];
      expect(prune(rows)).toEqual([]);
    });

    it('leaves a fully live thread untouched', () => {
      const rows = [comment('a'), comment('a1', { parentId: 'a' })];
      expect(prune(rows)).toEqual(['a', 'a1']);
    });
  });
});
