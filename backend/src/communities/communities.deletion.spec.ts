import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunitiesService } from './communities.service';

describe('CommunitiesService — deletion lifecycle & data cleanup', () => {
  const COMMUNITY_ID = 'comm-123';
  const OWNER_ID = 'owner-456';
  const OTHER_USER_ID = 'other-789';

  let service: CommunitiesService;
  let prisma: any;
  let mediaCleanupService: any;
  let domainEventService: any;
  let redisService: any;

  beforeEach(() => {
    prisma = {
      community: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === COMMUNITY_ID) {
            return {
              id: COMMUNITY_ID,
              name: 'Design Crew',
              ownerId: OWNER_ID,
              avatarKey: 'community-icons/comm1.png',
              coverKey: 'community-covers/cover1.jpg',
              collegeId: 'college-1',
              deletedAt: null,
            };
          }
          return null;
        }),
        update: jest.fn(async ({ data }: any) => data),
      },
      communityMember: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.userId_communityId?.userId === OWNER_ID) {
            return { role: 'OWNER' };
          }
          if (where.userId_communityId?.userId === OTHER_USER_ID) {
            return { role: 'MEMBER' };
          }
          return null;
        }),
        deleteMany: jest.fn(async () => ({ count: 5 })),
      },
      post: {
        findMany: jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }]),
        updateMany: jest.fn(async ({ data }: any) => data),
      },
      comment: {
        findMany: jest.fn(async () => [{ id: 'c1' }]),
        updateMany: jest.fn(async ({ data }: any) => data),
      },
      postLike: { deleteMany: jest.fn(async () => ({ count: 10 })) },
      postBookmark: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      postShare: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      postHashtag: { deleteMany: jest.fn(async () => ({ count: 3 })) },
      mention: { deleteMany: jest.fn(async () => ({ count: 4 })) },
      commentLike: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      pollVote: { deleteMany: jest.fn(async () => ({ count: 5 })) },
      pollOption: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      notification: { deleteMany: jest.fn(async () => ({ count: 8 })) },
      report: { updateMany: jest.fn(async () => ({ count: 1 })) },
      communityJoinRequest: { deleteMany: jest.fn(async () => ({ count: 3 })) },
      media: {
        findMany: jest.fn(async () => [{ objectKey: 'posts/p1_img.jpg' }]),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (fn: any) =>
        typeof fn === 'function' ? fn(prisma) : fn,
      ),
    };

    mediaCleanupService = {
      queueMediaDeletion: jest.fn(),
    };

    domainEventService = {
      emit: jest.fn(),
    };

    redisService = {
      getClient: () => ({
        del: jest.fn(async () => 1),
        sadd: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
        smembers: jest.fn(async () => []),
        keys: jest.fn(async () => []),
      }),
    };

    service = new CommunitiesService(
      prisma,
      domainEventService,
      redisService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mediaCleanupService,
    );
  });

  it('performs full transactional cleanup on community deletion', async () => {
    const result = await service.deleteCommunity(COMMUNITY_ID, OWNER_ID);
    expect(result).toEqual({ success: true, communityId: COMMUNITY_ID });

    // 1. Community soft-deleted
    expect(prisma.community.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMMUNITY_ID },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          memberCount: 0,
        }),
      }),
    );

    // 2. Posts soft-deleted
    expect(prisma.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1', 'p2'] } },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );

    // 3. Comments scrubbed
    expect(prisma.comment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { postId: { in: ['p1', 'p2'] } },
        data: expect.objectContaining({
          isDeleted: true,
          deletedAt: expect.any(Date),
          text: '',
          likeCount: 0,
        }),
      }),
    );

    // 4. Disposable relations hard-deleted
    expect(prisma.postLike.deleteMany).toHaveBeenCalled();
    expect(prisma.postBookmark.deleteMany).toHaveBeenCalled();
    expect(prisma.postShare.deleteMany).toHaveBeenCalled();
    expect(prisma.postHashtag.deleteMany).toHaveBeenCalled();
    expect(prisma.mention.deleteMany).toHaveBeenCalled();
    expect(prisma.commentLike.deleteMany).toHaveBeenCalled();
    expect(prisma.pollVote.deleteMany).toHaveBeenCalled();
    expect(prisma.pollOption.deleteMany).toHaveBeenCalled();
    expect(prisma.communityJoinRequest.deleteMany).toHaveBeenCalledWith({
      where: { communityId: COMMUNITY_ID },
    });
    expect(prisma.communityMember.deleteMany).toHaveBeenCalledWith({
      where: { communityId: COMMUNITY_ID },
    });

    // 5. Post media DB rows deleted
    expect(prisma.media.deleteMany).toHaveBeenCalledWith({
      where: { objectKey: { in: ['posts/p1_img.jpg'] } },
    });

    // 6. Durable R2 cleanup queued
    expect(mediaCleanupService.queueMediaDeletion).toHaveBeenCalledWith(
      expect.arrayContaining([
        'community-icons/comm1.png',
        'community-covers/cover1.jpg',
        'posts/p1_img.jpg',
      ]),
    );

    // 7. Domain event emitted
    expect(domainEventService.emit).toHaveBeenCalledWith(
      'community.deleted',
      expect.objectContaining({ communityId: COMMUNITY_ID }),
    );
  });

  it('refuses deletion if requesting user is not the owner', async () => {
    await expect(
      service.deleteCommunity(COMMUNITY_ID, OTHER_USER_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException if community does not exist or is already deleted', async () => {
    prisma.community.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.deleteCommunity('nonexistent', OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });
});
