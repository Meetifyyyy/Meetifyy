import { NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';

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

  beforeEach(() => {
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
      mediaCleanupService,
    );
  });

  it('performs full transactional cleanup on post deletion', async () => {
    const result = await service.deletePost(POST_ID, AUTHOR_ID);
    expect(result).toEqual({ success: true });

    // 1. Post is soft-deleted
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: POST_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );

    // 2. Comments are scrubbed with text='', mentions=null, likeCount=0
    expect(prisma.comment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { postId: POST_ID },
        data: expect.objectContaining({
          isDeleted: true,
          deletedAt: expect.any(Date),
          text: '',
          likeCount: 0,
        }),
      }),
    );

    // 3. Disposable engagement relations are hard-deleted
    expect(prisma.postLike.deleteMany).toHaveBeenCalledWith({
      where: { postId: POST_ID },
    });
    expect(prisma.postBookmark.deleteMany).toHaveBeenCalledWith({
      where: { postId: POST_ID },
    });
    expect(prisma.postShare.deleteMany).toHaveBeenCalledWith({
      where: { postId: POST_ID },
    });
    expect(prisma.postHashtag.deleteMany).toHaveBeenCalledWith({
      where: { postId: POST_ID },
    });
    expect(prisma.pollVote.deleteMany).toHaveBeenCalledWith({
      where: { postId: POST_ID },
    });
    expect(prisma.pollOption.deleteMany).toHaveBeenCalledWith({
      where: { postId: POST_ID },
    });

    // 4. Post and Comment mentions are hard-deleted
    expect(prisma.mention.deleteMany).toHaveBeenCalledWith({
      where: { sourceId: POST_ID, sourceType: 'POST' },
    });
    expect(prisma.mention.deleteMany).toHaveBeenCalledWith({
      where: { sourceId: { in: ['c1', 'c2'] }, sourceType: 'COMMENT' },
    });

    // 5. Comment likes are deleted
    expect(prisma.commentLike.deleteMany).toHaveBeenCalledWith({
      where: { commentId: { in: ['c1', 'c2'] } },
    });

    // 6. Durable R2 media deletion queue is called
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
