import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory
  ) {}

  async getAllUsers(limit: number, offset: number) {
    return this.prisma.user.findMany({
      take: limit,
      skip: offset,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        collegeId: true,
        major: true,
        graduationYear: true,
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        college: true,
        major: true,
      }
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        cover: true,
        bio: true,
        major: true,
        graduationYear: true,
        location: true,
        emailVerified: true,
        createdAt: true,
        college: { select: { name: true } },
        settings: {
          select: {
            privateProfile: true,
            showOnlineStatus: true,
            whoCanSeeOnline: true,
            showLastSeen: true,
            whoCanSeeLastSeen: true
          }
        },
        _count: {
          select: { followers: true, following: true, posts: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (currentUserId && currentUserId !== user.id) {
      const isBlocked = await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: currentUserId, blockedId: user.id },
            { blockerId: user.id, blockedId: currentUserId },
          ],
        },
      });
      if (isBlocked) {
        throw new NotFoundException('User not found');
      }
    }

    let isFollowing = false;
    if (currentUserId && currentUserId !== user.id) {
      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: user.id,
          },
        },
        select: { followerId: true },
      });
      isFollowing = !!follow;
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      cover: user.cover,
      bio: user.bio,
      college: user.college?.name || null,
      major: user.major,
      graduationYear: user.graduationYear,
      location: user.location,
      verified: user.emailVerified,
      createdAt: user.createdAt,
      settings: user.settings || null,
      isPrivate: user.settings?.privateProfile || false,
      stats: {
        followers: user._count.followers,
        following: user._count.following,
        posts: user._count.posts,
      },
      isFollowing,
    };
  }

  async followUser(followerId: string, followingUsername: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findUnique({ where: { username: followingUsername } });
      if (!targetUser) throw new NotFoundException('Target user not found');
      if (targetUser.id === followerId) throw new BadRequestException('Cannot follow yourself');

      const isBlocked = await tx.block.findFirst({
        where: {
          OR: [
            { blockerId: followerId, blockedId: targetUser.id },
            { blockerId: targetUser.id, blockedId: followerId },
          ],
        },
      });
      if (isBlocked) throw new BadRequestException('Action not allowed due to user block');

      const existing = await tx.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId,
            followingId: targetUser.id,
          },
        },
      });

      let newlyFollowed = false;
      if (!existing) {
        await tx.follow.create({
          data: {
            followerId,
            followingId: targetUser.id,
          },
        });
        newlyFollowed = true;
      }

      const [targetFollowers, targetFollowing, currentFollowing] = await Promise.all([
        tx.follow.count({ where: { followingId: targetUser.id } }),
        tx.follow.count({ where: { followerId: targetUser.id } }),
        tx.follow.count({ where: { followerId } }),
      ]);

      return {
        newlyFollowed,
        targetUser,
        targetFollowers,
        targetFollowing,
        currentFollowing,
      };
    });

    if (result.newlyFollowed) {
      const actor = await this.prisma.user.findUnique({
        where: { id: followerId },
        select: { username: true, displayName: true, avatar: true }
      });

      const followNotifDto = {
        recipientId: result.targetUser.id,
        actorId: followerId,
        type: 'FOLLOW' as any,
        entityType: null,
        entityId: followerId,
        title: 'New Follower',
        body: `${actor?.displayName || actor?.username || 'Someone'} started following you.`,
        metadata: {
          version: 1,
          actorId: followerId,
          username: actor?.username,
          actorDisplayName: actor?.displayName,
          actorAvatar: actor?.avatar,
        },
      };
      await this.notificationsService.createNotification(followNotifDto as any).catch(err => {
        this.logger?.warn?.('Failed to send follow notification', err);
      });
    }

    return {
      success: true,
      isFollowing: true,
      targetUser: {
        id: result.targetUser.id,
        username: result.targetUser.username,
        followersCount: result.targetFollowers,
        followingCount: result.targetFollowing,
      },
      currentUserStats: {
        followingCount: result.currentFollowing,
      },
    };
  }

  async unfollowUser(followerId: string, followingUsername: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findUnique({ where: { username: followingUsername } });
      if (!targetUser) throw new NotFoundException('Target user not found');

      const existing = await tx.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId,
            followingId: targetUser.id,
          },
        },
      });

      if (existing) {
        await tx.follow.delete({
          where: {
            followerId_followingId: {
              followerId,
              followingId: targetUser.id,
            },
          },
        });
      }

      const [targetFollowers, targetFollowing, currentFollowing] = await Promise.all([
        tx.follow.count({ where: { followingId: targetUser.id } }),
        tx.follow.count({ where: { followerId: targetUser.id } }),
        tx.follow.count({ where: { followerId } }),
      ]);

      return {
        targetUser,
        targetFollowers,
        targetFollowing,
        currentFollowing,
      };
    });

    return {
      success: true,
      isFollowing: false,
      targetUser: {
        id: result.targetUser.id,
        username: result.targetUser.username,
        followersCount: result.targetFollowers,
        followingCount: result.targetFollowing,
      },
      currentUserStats: {
        followingCount: result.currentFollowing,
      },
    };
  }

  async getFollowers(username: string, currentUserId?: string, limit = 20, offset = 0) {
    const targetUser = await this.prisma.user.findUnique({ where: { username } });
    if (!targetUser) throw new NotFoundException('User not found');

    const follows = await this.prisma.follow.findMany({
      where: { followingId: targetUser.id },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            bio: true,
            role: true,
          },
        },
      },
    });

    const followerUserIds = follows.map(f => f.follower.id);

    let myFollowingSet = new Set<string>();
    if (currentUserId && followerUserIds.length > 0) {
      const myFollows = await this.prisma.follow.findMany({
        where: {
          followerId: currentUserId,
          followingId: { in: followerUserIds },
        },
        select: { followingId: true },
      });
      myFollowingSet = new Set(myFollows.map(f => f.followingId));
    }

    return follows.map(f => ({
      ...f.follower,
      isFollowing: currentUserId ? myFollowingSet.has(f.follower.id) : false,
    }));
  }

  async getFollowing(username: string, currentUserId?: string, limit = 20, offset = 0) {
    const targetUser = await this.prisma.user.findUnique({ where: { username } });
    if (!targetUser) throw new NotFoundException('User not found');

    const follows = await this.prisma.follow.findMany({
      where: { followerId: targetUser.id },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        following: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            bio: true,
            role: true,
          },
        },
      },
    });

    const followingUserIds = follows.map(f => f.following.id);

    let myFollowingSet = new Set<string>();
    if (currentUserId && followingUserIds.length > 0) {
      const myFollows = await this.prisma.follow.findMany({
        where: {
          followerId: currentUserId,
          followingId: { in: followingUserIds },
        },
        select: { followingId: true },
      });
      myFollowingSet = new Set(myFollows.map(f => f.followingId));
    }

    return follows.map(f => ({
      ...f.following,
      isFollowing: currentUserId ? myFollowingSet.has(f.following.id) : false,
    }));
  }

  async updateProfile(userId: string, data: any) {
    // Only allow updating valid user profile fields
    const { displayName, username, bio, avatar, cover, major, graduationYear, location, profileCompleted, interests } = data;
    const updateData: any = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    
    if (username !== undefined) {
      const trimmedUsername = username.trim().toLowerCase();
      // Coupling reminder: If this validation regex is updated, keep the sanitizer in auth.service.ts in sync.
      const usernameRegex = /^[a-z0-9_.]{3,30}$/;
      if (!usernameRegex.test(trimmedUsername)) {
        throw new BadRequestException('Username must be 3-30 characters long and contain only lowercase letters, numbers, underscores, and dots.');
      }
      
      // Check if username is already taken by someone else
      const existing = await this.prisma.user.findUnique({ where: { username: trimmedUsername } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('Username is already taken.');
      }
      
      updateData.username = trimmedUsername;
    }
    
    if (bio !== undefined) updateData.bio = bio;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (cover !== undefined) updateData.cover = cover;
    
    // Map major / course / branch cleanly
    const computedMajor = major || [data.course, data.branch].filter(Boolean).join(' - ');
    if (computedMajor) updateData.major = computedMajor;

    // Parse graduationYear / year safely as integer
    const rawYear = graduationYear !== undefined ? graduationYear : data.year;
    if (rawYear !== undefined && rawYear !== null) {
      if (typeof rawYear === 'number') {
        updateData.graduationYear = Math.floor(rawYear);
      } else if (typeof rawYear === 'string') {
        const parsed = parseInt(rawYear.replace(/\D/g, ''), 10);
        if (!isNaN(parsed) && parsed >= 1990 && parsed <= 2100) {
          updateData.graduationYear = parsed;
        } else {
          const currentYear = new Date().getFullYear();
          if (rawYear.includes('1st')) updateData.graduationYear = currentYear + 3;
          else if (rawYear.includes('2nd')) updateData.graduationYear = currentYear + 2;
          else if (rawYear.includes('3rd')) updateData.graduationYear = currentYear + 1;
          else if (rawYear.includes('4th')) updateData.graduationYear = currentYear;
        }
      }
    }

    if (location !== undefined) updateData.location = location;
    if (profileCompleted !== undefined) updateData.profileCompleted = profileCompleted;
    if (Array.isArray(interests)) updateData.interests = interests.filter(i => typeof i === 'string');

    const fallbackUsername = updateData.username || `user_${Date.now()}`;
    const fallbackDisplayName = updateData.displayName || fallbackUsername;
    const fallbackEmail = `${userId}@meetifyy.user`;

    return this.prisma.user.upsert({
      where: { id: userId },
      update: updateData,
      create: {
        id: userId,
        username: fallbackUsername,
        displayName: fallbackDisplayName,
        email: fallbackEmail,
        ...updateData,
        notificationPrefs: {
          create: {},
        },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        cover: true,
        bio: true,
        major: true,
        graduationYear: true,
        location: true,
        interests: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getSettings(userId: string) {
    let settings = await this.prisma.userSettings.findUnique({
      where: { userId }
    });
    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: { userId }
      });
    }
    return settings;
  }

  async updateSettings(userId: string, data: any) {
    const payload: any = {};
    if (typeof data.emailNotifs === 'boolean') payload.emailNotifs = data.emailNotifs;
    if (typeof data.pushNotifs === 'boolean') payload.pushNotifs = data.pushNotifs;
    if (typeof data.privateProfile === 'boolean') payload.privateProfile = data.privateProfile;
    if (typeof data.showOnlineStatus === 'boolean') payload.showOnlineStatus = data.showOnlineStatus;
    if (typeof data.showLastSeen === 'boolean') payload.showLastSeen = data.showLastSeen;
    if (typeof data.readReceipts === 'boolean') payload.readReceipts = data.readReceipts;

    const validWho = ['everyone', 'following', 'mutual', 'nobody'];
    if (typeof data.whoCanSeeOnline === 'string' && validWho.includes(data.whoCanSeeOnline)) {
      payload.whoCanSeeOnline = data.whoCanSeeOnline;
    }
    if (typeof data.whoCanSeeLastSeen === 'string' && validWho.includes(data.whoCanSeeLastSeen)) {
      payload.whoCanSeeLastSeen = data.whoCanSeeLastSeen;
    }

    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...payload },
      update: { ...payload }
    });
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException('Cannot block yourself');
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    return { success: true, blocked: true };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({
      where: { blockerId, blockedId },
    });
    return { success: true, blocked: false };
  }
}
