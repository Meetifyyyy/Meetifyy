import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from './blocks.service';

function validateBirthday(birthdayStr: string) {
  if (!birthdayStr) {
    throw new BadRequestException('Date of birth is required.');
  }

  const parts = birthdayStr.split('-');
  if (parts.length !== 3) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  if (isNaN(y) || isNaN(m) || isNaN(d)) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const currentYear = new Date().getFullYear();
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > currentYear) {
    throw new BadRequestException(`Year of birth must be between 1990 and ${currentYear}.`);
  }

  const dateObj = new Date(y, m - 1, d);
  if (dateObj.getFullYear() !== y || dateObj.getMonth() !== m - 1 || dateObj.getDate() !== d) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dateObj.setHours(0, 0, 0, 0);

  if (dateObj > today) {
    throw new BadRequestException('Date of birth cannot be in the future.');
  }

  const age18Date = new Date(y + 18, m - 1, d);
  age18Date.setHours(0, 0, 0, 0);
  if (age18Date > today) {
    throw new BadRequestException('You must be at least 18 years old.');
  }

  const age120Date = new Date(y + 120, m - 1, d);
  if (age120Date < today) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly domainEventService: DomainEventService,
    private readonly redisService: RedisService,
    private readonly blocksService: BlocksService,
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

  async getCampusUsers(userIdOrCollegeId: string, limit: number, offset: number) {
    if (!userIdOrCollegeId) return [];
    let collegeId = userIdOrCollegeId;
    let excludeUserId: string | undefined = undefined;

    // Check if the argument is a userId by performing a database lookup
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userIdOrCollegeId },
      select: { collegeId: true }
    });
    if (targetUser) {
      if (!targetUser.collegeId) return [];
      collegeId = targetUser.collegeId;
      excludeUserId = userIdOrCollegeId;
    }

    return this.prisma.user.findMany({
      where: {
        collegeId,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {})
      },
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
        college: { select: { name: true } }
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
        profileCompleted: true,
      }
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const cleanUsername = username.trim().toLowerCase();

    // First: fetch the user (needed for user.id before we can check block/follow)
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanUsername },
          { id: cleanUsername }
        ]
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        cover: true,
        bio: true,
        birthday: true,
        major: true,
        graduationYear: true,
        location: true,
        interests: true,
        emailVerified: true,
        profileCompleted: true,
        createdAt: true,
        college: { select: { name: true } },
        settings: {
          select: {
            privateProfile: true,
            showOnlineStatus: true,
            whoCanSeeOnline: true
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

    // Now run block check and follow check in parallel — both need user.id
    const [blockRecord, followRecord] = await Promise.all([
      currentUserId && currentUserId !== user.id
        ? this.prisma.block.findFirst({
            where: {
              OR: [
                { blockerId: currentUserId, blockedId: user.id },
                { blockerId: user.id, blockedId: currentUserId },
              ],
            },
            select: { blockerId: true },
          })
        : Promise.resolve(null),
      currentUserId && currentUserId !== user.id
        ? this.prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: currentUserId,
                followingId: user.id,
              },
            },
            select: { followerId: true },
          })
        : Promise.resolve(null),
    ]);

    if (blockRecord) {
      throw new NotFoundException('User not found');
    }

    const isFollowing = !!followRecord;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      cover: user.cover,
      bio: user.bio,
      birthday: user.birthday,
      college: user.college?.name || null,
      major: user.major,
      graduationYear: user.graduationYear,
      location: user.location,
      interests: user.interests,
      verified: user.emailVerified,
      profileCompleted: user.profileCompleted,
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
    const cleanUsername = followingUsername.trim().toLowerCase();
    const targetUser = await this.prisma.user.findUnique({ where: { username: cleanUsername } });
    if (!targetUser) throw new NotFoundException('Target user not found');
    if (targetUser.id === followerId) throw new BadRequestException('Cannot follow yourself');

    const lockKey = `toggle:follow:${followerId}:${targetUser.id}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      const isBlocked = await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: followerId, blockedId: targetUser.id },
            { blockerId: targetUser.id, blockedId: followerId },
          ],
        },
      });
      if (isBlocked) throw new BadRequestException('Action not allowed due to user block');

      // Fully atomic: INSERT ... ON CONFLICT DO NOTHING
      // Never throws P2002 regardless of concurrent requests.
      const result = await this.prisma.$executeRaw`
        INSERT INTO "Follow" ("followerId", "followingId", "createdAt")
        VALUES (${followerId}, ${targetUser.id}, NOW())
        ON CONFLICT ("followerId", "followingId") DO NOTHING
      `;
      const newlyFollowed = result === 1;

      const [targetFollowers, targetFollowing, currentFollowing] = await Promise.all([
        this.prisma.follow.count({ where: { followingId: targetUser.id } }),
        this.prisma.follow.count({ where: { followerId: targetUser.id } }),
        this.prisma.follow.count({ where: { followerId } }),
      ]);

      if (newlyFollowed) {
        this.domainEventService.emit('follow.created', {
          followerId,
          followingId: targetUser.id,
          followingUsername: targetUser.username,
          followerStats: { followingCount: currentFollowing },
          targetStats: { followersCount: targetFollowers },
        }).catch(err => this.logger.warn('Failed to emit follow.created event', err));
      }

      return {
        success: true,
        isFollowing: true,
        targetUser: {
          id: targetUser.id,
          username: targetUser.username,
          followersCount: targetFollowers,
          followingCount: targetFollowing,
        },
        currentUserStats: { followingCount: currentFollowing },
      };
    });
  }

  async unfollowUser(followerId: string, followingUsername: string) {
    const cleanUsername = followingUsername.trim().toLowerCase();
    const targetUser = await this.prisma.user.findUnique({ where: { username: cleanUsername } });
    if (!targetUser) throw new NotFoundException('Target user not found');

    const lockKey = `toggle:follow:${followerId}:${targetUser.id}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      const deleteRes = await this.prisma.follow.deleteMany({
        where: {
          followerId,
          followingId: targetUser.id,
        },
      });

      const [targetFollowers, targetFollowing, currentFollowing] = await Promise.all([
        this.prisma.follow.count({ where: { followingId: targetUser.id } }),
        this.prisma.follow.count({ where: { followerId: targetUser.id } }),
        this.prisma.follow.count({ where: { followerId } }),
      ]);

      if (deleteRes.count > 0) {
        this.domainEventService.emit('follow.deleted', {
          followerId,
          followingId: targetUser.id,
          followingUsername: targetUser.username,
          followerStats: { followingCount: currentFollowing },
          targetStats: { followersCount: targetFollowers }
        }).catch(err => this.logger.warn('Failed to emit follow.deleted event', err));
      }

      return {
        success: true,
        isFollowing: false,
        targetUser: {
          id: targetUser.id,
          username: targetUser.username,
          followersCount: targetFollowers,
          followingCount: targetFollowing,
        },
        currentUserStats: {
          followingCount: currentFollowing,
        },
      };
    });
  }

  async getFollowers(username: string, currentUserId?: string, limit = 20, offset = 0) {
    const cleanUsername = username.trim().toLowerCase();
    const targetUser = await this.prisma.user.findUnique({ where: { username: cleanUsername } });
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

    const validFollows = follows.filter(f => f.follower != null);
    const followerUserIds = validFollows.map(f => f.follower.id);

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

    return validFollows.map(f => ({
      ...f.follower,
      isFollowing: currentUserId ? myFollowingSet.has(f.follower.id) : false,
    }));
  }

  async getFollowing(username: string, currentUserId?: string, limit = 20, offset = 0) {
    const cleanUsername = username.trim().toLowerCase();
    const targetUser = await this.prisma.user.findUnique({ where: { username: cleanUsername } });
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

    const validFollows = follows.filter(f => f.following != null);
    const followingUserIds = validFollows.map(f => f.following.id);

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

    return validFollows.map(f => ({
      ...f.following,
      isFollowing: currentUserId ? myFollowingSet.has(f.following.id) : false,
    }));
  }

  async updateProfile(userId: string, data: any, userEmail?: string) {
    // Only allow updating valid user profile fields
    const { displayName, username, bio, avatar, cover, major, graduationYear, location, profileCompleted, interests, birthday } = data;
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

    if (birthday !== undefined) {
      if (birthday !== null && birthday !== '') {
        validateBirthday(birthday);
      }
      updateData.birthday = birthday;
    }
    
    if (avatar !== undefined) {
      updateData.avatar = avatar;
      if (avatar && typeof avatar === 'string') {
        if (avatar.startsWith('/api/media/')) {
          const objectKey = avatar.replace('/api/media/', '');
          updateData.avatarMedia = { connect: { objectKey } };
        } else if (avatar.startsWith('http')) {
          updateData.avatarMedia = {
            create: {
              provider: 'external',
              bucket: 'external',
              objectKey: avatar,
              mimeType: 'image/jpeg',
              fileSize: 0,
              ownerId: userId,
            }
          };
        }
      }
    }
    
    if (cover !== undefined) {
      updateData.cover = cover;
      if (cover && typeof cover === 'string') {
        if (cover.startsWith('/api/media/')) {
          const objectKey = cover.replace('/api/media/', '');
          updateData.coverMedia = { connect: { objectKey } };
        } else if (cover.startsWith('http')) {
          updateData.coverMedia = {
            create: {
              provider: 'external',
              bucket: 'external',
              objectKey: cover,
              mimeType: 'image/jpeg',
              fileSize: 0,
              ownerId: userId,
            }
          };
        }
      }
    }
    
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
    const realEmail = userEmail && !userEmail.endsWith('@meetifyy.user') ? userEmail.trim().toLowerCase() : (data.email || `${userId}@meetifyy.user`);

    // Auto-heal email if existing record has fallback
    const existingUserRecord = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (existingUserRecord && (existingUserRecord.email.endsWith('@meetifyy.user') || !existingUserRecord.email) && realEmail && !realEmail.endsWith('@meetifyy.user')) {
      updateData.email = realEmail;
    }

    return this.prisma.user.upsert({
      where: { id: userId },
      update: updateData,
      create: {
        id: userId,
        username: fallbackUsername,
        displayName: fallbackDisplayName,
        email: realEmail,
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
        birthday: true,
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
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updateSettings(userId: string, data: any) {
    const payload: any = {};
    if (typeof data.emailNotifs === 'boolean') payload.emailNotifs = data.emailNotifs;
    if (typeof data.pushNotifs === 'boolean') payload.pushNotifs = data.pushNotifs;
    if (typeof data.privateProfile === 'boolean') payload.privateProfile = data.privateProfile;
    if (typeof data.showOnlineStatus === 'boolean') payload.showOnlineStatus = data.showOnlineStatus;
    if (typeof data.readReceipts === 'boolean') payload.readReceipts = data.readReceipts;

    const validWho = ['everyone', 'following', 'mutual', 'nobody'];
    if (typeof data.whoCanSeeOnline === 'string' && validWho.includes(data.whoCanSeeOnline)) {
      payload.whoCanSeeOnline = data.whoCanSeeOnline;
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
    // Invalidate cached block lists for both users
    await this.blocksService.invalidateBlockCache(blockerId, blockedId);
    return { success: true, blocked: true };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({
      where: { blockerId, blockedId },
    });
    // Invalidate cached block lists for both users
    await this.blocksService.invalidateBlockCache(blockerId, blockedId);
    return { success: true, blocked: false };
  }
}
