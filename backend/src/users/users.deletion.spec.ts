import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';

describe('UsersService — account deletion lifecycle & data cleanup', () => {
  const USER_ID = 'user-abc-123';

  let service: UsersService;
  let prisma: any;
  let presenceService: any;
  let mediaCleanupService: any;
  let domainEventService: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === USER_ID) {
            return {
              id: USER_ID,
              username: 'johndoe',
              displayName: 'John Doe',
              avatar: 'https://r2.meetifyy.com/avatars/user1.jpg',
              cover: 'https://r2.meetifyy.com/profile-covers/cover1.jpg',
              deletedAt: null,
            };
          }
          return null;
        }),
        update: jest.fn(async ({ data }: any) => data),
      },
      post: {
        findMany: jest.fn(async () => [{ id: 'post-1' }, { id: 'post-2' }]),
        updateMany: jest.fn(async ({ data }: any) => data),
      },
      community: {
        findMany: jest.fn(async () => [
          {
            id: 'comm-1',
            name: 'Sole Community',
            avatarKey: 'community-icons/comm1.png',
            coverKey: 'community-covers/comm1.jpg',
          },
        ]),
        update: jest.fn(async ({ data }: any) => data),
      },
      communityMember: {
        findMany: jest.fn(async () => []), // sole member
        update: jest.fn(async ({ data }: any) => data),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      communityJoinRequest: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      follow: { deleteMany: jest.fn(async () => ({ count: 10 })) },
      postBookmark: { deleteMany: jest.fn(async () => ({ count: 3 })) },
      postLike: { deleteMany: jest.fn(async () => ({ count: 8 })) },
      postShare: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      postHashtag: { deleteMany: jest.fn(async () => ({ count: 5 })) },
      mention: { deleteMany: jest.fn(async () => ({ count: 4 })) },
      pollVote: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      pollOption: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      commentLike: { deleteMany: jest.fn(async () => ({ count: 6 })) },
      activityBookmark: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      activityInvitation: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      crewActivityMember: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      matchQueueEntry: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      block: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      mute: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      recentSearch: { deleteMany: jest.fn(async () => ({ count: 4 })) },
      deletedMessage: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      messageReaction: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      conversationJoinRequest: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      notificationPreferences: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      userSettings: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      notification: { deleteMany: jest.fn(async () => ({ count: 15 })) },
      comment: {
        updateMany: jest.fn(async ({ data }: any) => data),
      },
      media: {
        findMany: jest.fn(async () => [
          { objectKey: 'posts/post_img1.jpg' },
        ]),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (fn: any) =>
        typeof fn === 'function' ? fn(prisma) : fn,
      ),
    };

    presenceService = {
      removePresence: jest.fn(async () => {}),
      getPresence: jest.fn(async () => null),
      getPresenceMany: jest.fn(async () => new Map()),
    };

    mediaCleanupService = {
      extractStorageKey: jest.fn((val: string) => {
        if (!val) return null;
        if (val.includes('avatars/')) return 'avatars/user1.jpg';
        if (val.includes('profile-covers/')) return 'profile-covers/cover1.jpg';
        return val;
      }),
      isProtectedKey: jest.fn(() => false),
      queueMediaDeletion: jest.fn(),
    };

    domainEventService = {
      emit: jest.fn(),
    };

    service = new UsersService(
      prisma,
      {} as any,
      {} as any,
      domainEventService,
      { getClient: () => null } as any,
      { injectBlockFilter: jest.fn(async (_u, w) => w) } as any,
      presenceService,
      {} as any,
      {} as any,
      mediaCleanupService,
    );
  });

  it('performs full transactional anonymization, post cleanup, community reassignment, and durable media queueing', async () => {
    const result = await service.deleteAccount(USER_ID);
    expect(result).toEqual({ success: true });

    // 1. User is anonymized & stamped with DELETED accountStatus
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          accountStatus: 'DELETED',
          displayName: 'Deleted User',
          username: expect.stringMatching(/^deleted_user-abc_\d+$/),
          email: `deleted_${USER_ID}@deleted.meetifyy`,
          collegeEmail: null,
          avatar: null,
          cover: null,
          bio: null,
          profileCompleted: false,
        }),
      }),
    );

    // 2. User's authored posts are soft-deleted and engagement relations removed
    expect(prisma.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['post-1', 'post-2'] } },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.postLike.deleteMany).toHaveBeenCalled();
    expect(prisma.postBookmark.deleteMany).toHaveBeenCalled();
    expect(prisma.postShare.deleteMany).toHaveBeenCalled();
    expect(prisma.postHashtag.deleteMany).toHaveBeenCalled();
    expect(prisma.pollVote.deleteMany).toHaveBeenCalled();
    expect(prisma.pollOption.deleteMany).toHaveBeenCalled();

    // 3. User-level relations are hard-deleted
    expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ followerId: USER_ID }, { followingId: USER_ID }] },
    });
    expect(prisma.activityBookmark.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.activityInvitation.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ inviterId: USER_ID }, { inviteeId: USER_ID }] },
    });
    expect(prisma.crewActivityMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.matchQueueEntry.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.block.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ blockerId: USER_ID }, { blockedId: USER_ID }] },
    });
    expect(prisma.mute.deleteMany).toHaveBeenCalledWith({
      where: { muterId: USER_ID },
    });
    expect(prisma.recentSearch.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.messageReaction.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.userSettings.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });

    // 4. Authored comments across all other posts are scrubbed
    expect(prisma.comment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { authorId: USER_ID, isDeleted: false },
        data: expect.objectContaining({
          isDeleted: true,
          deletedAt: expect.any(Date),
          text: '',
          likeCount: 0,
        }),
      }),
    );

    // 5. User token is instantly revoked in JwtGuard
    expect(JwtGuard.isUserRevoked(USER_ID)).toBe(true);

    // 6. Presence key removed
    expect(presenceService.removePresence).toHaveBeenCalledWith(USER_ID);

    // 7. Durable R2 media queueing is called
    expect(mediaCleanupService.queueMediaDeletion).toHaveBeenCalledWith(
      expect.arrayContaining(['avatars/user1.jpg', 'profile-covers/cover1.jpg']),
    );

    // 8. Domain event emitted
    expect(domainEventService.emit).toHaveBeenCalledWith('user.deleted', {
      userId: USER_ID,
    });
  });

  it('throws NotFoundException if user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteAccount('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException if user is already deleted (idempotent)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: USER_ID,
      deletedAt: new Date(),
    });
    await expect(service.deleteAccount(USER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getUserById throws NotFoundException for soft-deleted user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: USER_ID,
      username: 'johndoe',
      deletedAt: new Date(),
    });
    await expect(service.getUserById(USER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
