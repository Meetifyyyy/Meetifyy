import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from './blocks.service';
import { PresenceService } from '../presence/presence.service';
import { checkPresenceVisibility } from './privacy.helper';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE, FollowNotifJob } from '../notifications/notifications.processor';
import { clearAuthSyncCache } from '../auth/auth.service';

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
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > currentYear) {
    throw new BadRequestException(`Year of birth must be between 1950 and ${currentYear}.`);
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
    private readonly presenceService: PresenceService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notifQueue: Queue,
  ) {}

  async getAllUsers(limit: number, offset: number) {
    const users = await this.prisma.user.findMany({
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
        settings: {
          select: {
            showOnlineStatus: true,
            whoCanSeeOnline: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const userIds = users.map(u => u.id);
    const presenceMap = await this.presenceService.getPresenceMany(userIds);

    return users.map(u => {
      const pres = presenceMap.get(u.id);
      const isOnline = pres?.status === 'online';
      return {
        ...u,
        isOnline,
        online: isOnline,
        lastActive: pres?.lastSeen || null,
      };
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

    const users = await this.prisma.user.findMany({
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
        college: { select: { name: true } },
        settings: {
          select: {
            showOnlineStatus: true,
            whoCanSeeOnline: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const userIds = users.map(u => u.id);
    const presenceMap = await this.presenceService.getPresenceMany(userIds);

    return users.map(u => {
      const pres = presenceMap.get(u.id);
      const isOnline = pres?.status === 'online';
      return {
        ...u,
        isOnline,
        online: isOnline,
        lastActive: pres?.lastSeen || null,
      };
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
    const pres = await this.presenceService.getPresence(id);
    const isOnline = pres?.status === 'online';
    return {
      ...user,
      isOnline,
      online: isOnline,
      lastActive: pres?.lastSeen || null,
    };
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const cleanUsername = username.trim().toLowerCase();

    // 1. Find user by exact username (case-insensitive), or ID, or email prefix, or handle prefix, or displayName
    let targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: cleanUsername, mode: 'insensitive' } },
          { id: cleanUsername },
          { email: { equals: cleanUsername, mode: 'insensitive' } },
          { collegeEmail: { equals: cleanUsername, mode: 'insensitive' } }
        ],
      },
      include: {
        college: { select: { name: true } },
        settings: {
          select: {
            privateProfile: true,
            showOnlineStatus: true,
            whoCanSeeOnline: true,
          },
        },
        _count: {
          select: {
            followers: true,
            following: true,
            posts: {
              where: {
                deletedAt: null,
                communityId: null,
              },
            },
          },
        },
      },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    let isBlocked = false;
    let isFollowing = false;
    let isFollowedBy = false;

    if (currentUserId && currentUserId !== targetUser.id) {
      const [blockCount, followRecord, followedByRecord] = await Promise.all([
        this.prisma.block.count({
          where: {
            OR: [
              { blockerId: currentUserId, blockedId: targetUser.id },
              { blockerId: targetUser.id, blockedId: currentUserId },
            ],
          },
        }),
        this.prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: currentUserId,
              followingId: targetUser.id,
            },
          },
        }),
        this.prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: targetUser.id,
              followingId: currentUserId,
            },
          },
        }),
      ]);

      isBlocked = blockCount > 0;
      isFollowing = !!followRecord;
      isFollowedBy = !!followedByRecord;
    }

    if (isBlocked) {
      throw new NotFoundException('User not found');
    }

    const presence = await this.presenceService.getPresence(targetUser.id);
    const canSeeOnline = await checkPresenceVisibility(
      targetUser.id,
      currentUserId || '',
      targetUser.settings?.whoCanSeeOnline || 'everyone',
      targetUser.settings?.showOnlineStatus !== false,
      this.prisma
    );
    const isOnline = canSeeOnline ? (presence?.status === 'online') : false;

    const settings = targetUser.settings
      ? {
          privateProfile: !!targetUser.settings.privateProfile,
          showOnlineStatus: targetUser.settings.showOnlineStatus ?? true,
          whoCanSeeOnline: targetUser.settings.whoCanSeeOnline ?? 'everyone',
        }
      : null;

    return {
      id: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      avatar: targetUser.avatar,
      cover: targetUser.cover,
      bio: targetUser.bio,
      birthday: targetUser.birthday,
      college: targetUser.college?.name || null,
      major: targetUser.major,
      graduationYear: targetUser.graduationYear,
      location: targetUser.location,
      interests: targetUser.interests || [],
      verified: targetUser.emailVerified,
      profileCompleted: targetUser.profileCompleted,
      createdAt: targetUser.createdAt,
      settings,
      isPrivate: targetUser.settings?.privateProfile || false,
      isOnline,
      online: isOnline,
      lastActive: presence?.lastSeen || null,
      stats: {
        followers: targetUser._count.followers,
        following: targetUser._count.following,
        posts: targetUser._count.posts,
      },
      isFollowing,
      isFollowedBy,
      isMutual: isFollowing && isFollowedBy,
    };
  }

  async followUser(followerId: string, followingUsername: string) {
    const t0 = performance.now();
    const cleanUsername = followingUsername.trim().toLowerCase();
    
    // Single atomic CTE query combining: user lookup + block check + follow insert + count calculation
    // Reduces database network round-trips from 4 down to 1!
    const rows: any[] = await this.prisma.$queryRaw`
      WITH target_user AS (
        SELECT "id", "username", "displayName", "avatar"
        FROM "User"
        WHERE "username" = ${cleanUsername} OR "id" = ${cleanUsername}
        LIMIT 1
      ),
      follower_user AS (
        SELECT "id", "username", "displayName", "avatar"
        FROM "User"
        WHERE "id" = ${followerId}
        LIMIT 1
      ),
      block_check AS (
        SELECT 1 FROM "Block" b, target_user tu
        WHERE (b."blockerId" = ${followerId} AND b."blockedId" = tu."id")
           OR (b."blockerId" = tu."id" AND b."blockedId" = ${followerId})
        LIMIT 1
      ),
      ins AS (
        INSERT INTO "Follow" ("followerId", "followingId", "createdAt")
        SELECT ${followerId}, tu."id", NOW()
        FROM target_user tu
        WHERE NOT EXISTS (SELECT 1 FROM block_check)
          AND tu."id" != ${followerId}
        ON CONFLICT ("followerId", "followingId") DO NOTHING
        RETURNING "followingId"
      )
      SELECT 
        tu."id" AS "targetId",
        tu."username" AS "targetUsername",
        tu."displayName" AS "targetDisplayName",
        tu."avatar" AS "targetAvatar",
        fu."username" AS "followerUsername",
        fu."displayName" AS "followerDisplayName",
        fu."avatar" AS "followerAvatar",
        EXISTS(SELECT 1 FROM block_check) AS "isBlocked",
        EXISTS(SELECT 1 FROM ins) AS "newlyFollowed",
        ((SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followingId" = tu."id") + CASE WHEN EXISTS(SELECT 1 FROM ins) THEN 1 ELSE 0 END) AS "targetFollowers",
        (SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followerId" = tu."id") AS "targetFollowing",
        ((SELECT COUNT(*)::int FROM "Follow" f WHERE f."followerId" = ${followerId}) + CASE WHEN EXISTS(SELECT 1 FROM ins) THEN 1 ELSE 0 END) AS "currentFollowing"
      FROM target_user tu
      CROSS JOIN follower_user fu;
    `;

    const tDb = performance.now();

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Target user not found');
    }

    const res = rows[0];

    if (res.targetId === followerId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    if (res.isBlocked) {
      throw new BadRequestException('Action not allowed due to user block');
    }

    if (res.newlyFollowed) {
      // Async non-blocking notification queue
      const jobData: FollowNotifJob = {
        followerId,
        followingId: res.targetId,
        actor: {
          username: res.followerUsername,
          displayName: res.followerDisplayName,
          avatar: res.followerAvatar,
        },
      };
      this.notifQueue.add('follow-notification', jobData, {
        removeOnComplete: true,
        removeOnFail: { count: 50 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      }).catch(err => this.logger.warn('Failed to enqueue follow notification', err));

      // Async non-blocking domain event broadcast
      this.domainEventService.emit('follow.created', {
        followerId,
        followingId: res.targetId,
        followingUsername: res.targetUsername,
        followerStats: { followingCount: res.currentFollowing },
        targetStats: { followersCount: res.targetFollowers },
      }).catch(err => this.logger.warn('Failed to emit follow.created event', err));
    }

    const tEnd = performance.now();
    this.logger.log(`[TIMING followUser] singleQueryDb=${(tDb - t0).toFixed(1)}ms total=${(tEnd - t0).toFixed(1)}ms (1 round-trip)`);

    return {
      success: true,
      isFollowing: true,
      targetUser: {
        id: res.targetId,
        username: res.targetUsername,
        followersCount: res.targetFollowers,
        followingCount: res.targetFollowing,
      },
      currentUserStats: { followingCount: res.currentFollowing },
    };
  }

  async unfollowUser(followerId: string, followingUsername: string) {
    const t0 = performance.now();
    const cleanUsername = followingUsername.trim().toLowerCase();
    
    // Single atomic CTE query combining: user lookup + follow delete + count calculation
    // Reduces database network round-trips from 3 down to 1!
    const rows: any[] = await this.prisma.$queryRaw`
      WITH target_user AS (
        SELECT "id", "username"
        FROM "User"
        WHERE "username" = ${cleanUsername} OR "id" = ${cleanUsername}
        LIMIT 1
      ),
      del AS (
        DELETE FROM "Follow" f
        USING target_user tu
        WHERE f."followerId" = ${followerId} AND f."followingId" = tu."id"
        RETURNING f."followingId"
      )
      SELECT 
        tu."id" AS "targetId",
        tu."username" AS "targetUsername",
        EXISTS(SELECT 1 FROM del) AS "unfollowed",
        GREATEST(0, (SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followingId" = tu."id") - CASE WHEN EXISTS(SELECT 1 FROM del) THEN 1 ELSE 0 END) AS "targetFollowers",
        (SELECT COUNT(*)::int FROM "Follow" f, target_user tu WHERE f."followerId" = tu."id") AS "targetFollowing",
        GREATEST(0, (SELECT COUNT(*)::int FROM "Follow" f WHERE f."followerId" = ${followerId}) - CASE WHEN EXISTS(SELECT 1 FROM del) THEN 1 ELSE 0 END) AS "currentFollowing"
      FROM target_user tu;
    `;

    const tDb = performance.now();

    if (!rows || rows.length === 0) {
      throw new NotFoundException('User not found');
    }

    const res = rows[0];

    if (res.unfollowed) {
      this.domainEventService.emit('follow.deleted', {
        followerId,
        followingId: res.targetId,
        followingUsername: res.targetUsername,
        followerStats: { followingCount: res.currentFollowing },
        targetStats: { followersCount: res.targetFollowers },
      }).catch(err => this.logger.warn('Failed to emit follow.deleted event', err));
    }

    const tEnd = performance.now();
    this.logger.log(`[TIMING unfollowUser] singleQueryDb=${(tDb - t0).toFixed(1)}ms total=${(tEnd - t0).toFixed(1)}ms (1 round-trip)`);

    return {
      success: true,
      isFollowing: false,
      targetUser: {
        id: res.targetId,
        username: res.targetUsername,
        followersCount: res.targetFollowers,
        followingCount: res.targetFollowing,
      },
      currentUserStats: { followingCount: res.currentFollowing },
    };
  }

  async getFollowers(username: string, currentUserId?: string, limit = 20, offset = 0) {
    const cleanUsername = username.trim().toLowerCase();

    const targetUser = await this.prisma.user.findUnique({
      where: { username: cleanUsername },
      select: { id: true },
    });
    if (!targetUser) throw new NotFoundException('User not found');

    const rows: any[] = await this.prisma.$queryRaw`
      SELECT 
        u."id",
        u."username",
        u."displayName",
        u."avatar",
        u."bio",
        u."role",
        CASE WHEN ${currentUserId ? currentUserId : ''}::text != '' THEN
          EXISTS(
            SELECT 1 FROM "Follow" my_f 
            WHERE my_f."followerId" = ${currentUserId || ''} AND my_f."followingId" = u."id"
          )
        ELSE false END AS "isFollowing"
      FROM "Follow" f
      JOIN "User" u ON f."followerId" = u."id"
      WHERE f."followingId" = ${targetUser.id}
      ORDER BY f."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const userIds = rows.map(r => r.id);
    const presenceMap = await this.presenceService.getPresenceMany(userIds);

    return rows.map(r => {
      const pres = presenceMap.get(r.id);
      const isOnline = pres?.status === 'online';
      return {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatar: r.avatar,
        bio: r.bio,
        role: r.role,
        isFollowing: !!r.isFollowing,
        isOnline,
        online: isOnline,
        lastActive: pres?.lastSeen || null,
      };
    });
  }

  async getFollowing(username: string, currentUserId?: string, limit = 20, offset = 0) {
    const cleanUsername = username.trim().toLowerCase();

    const targetUser = await this.prisma.user.findUnique({
      where: { username: cleanUsername },
      select: { id: true },
    });
    if (!targetUser) throw new NotFoundException('User not found');

    const rows: any[] = await this.prisma.$queryRaw`
      SELECT 
        u."id",
        u."username",
        u."displayName",
        u."avatar",
        u."bio",
        u."role",
        CASE WHEN ${currentUserId ? currentUserId : ''}::text != '' THEN
          EXISTS(
            SELECT 1 FROM "Follow" my_f 
            WHERE my_f."followerId" = ${currentUserId || ''} AND my_f."followingId" = u."id"
          )
        ELSE false END AS "isFollowing"
      FROM "Follow" f
      JOIN "User" u ON f."followingId" = u."id"
      WHERE f."followerId" = ${targetUser.id}
      ORDER BY f."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const userIds = rows.map(r => r.id);
    const presenceMap = await this.presenceService.getPresenceMany(userIds);

    return rows.map(r => {
      const pres = presenceMap.get(r.id);
      const isOnline = pres?.status === 'online';
      return {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatar: r.avatar,
        bio: r.bio,
        role: r.role,
        isFollowing: !!r.isFollowing,
        isOnline,
        online: isOnline,
        lastActive: pres?.lastSeen || null,
      };
    });
  }

  async updateProfile(userId: string, data: any, userEmail?: string) {
    // Only allow updating valid user profile fields
    const { displayName, username, bio, avatar, cover, major, graduationYear, location, profileCompleted, interests, birthday } = data;
    const updateData: any = {};
    if (displayName !== undefined) {
      const trimmedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
      if (trimmedDisplayName.length > 30) {
        throw new BadRequestException('Name cannot exceed 30 characters');
      }
      updateData.displayName = trimmedDisplayName;
    }
    
    if (username !== undefined) {
      const trimmedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
      if (trimmedUsername.length > 30) {
        throw new BadRequestException('Username cannot exceed 30 characters');
      }
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
    
    if (bio !== undefined) {
      const trimmedBio = typeof bio === 'string' ? bio.trim() : '';
      if (trimmedBio.length > 200) {
        throw new BadRequestException('Description cannot exceed 200 characters');
      }
      updateData.bio = trimmedBio;
    }

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
    if (rawYear !== undefined && rawYear !== null && rawYear !== '') {
      const currentYear = new Date().getFullYear();
      const maxGraduationYear = currentYear + 6;

      let parsedYear = NaN;
      if (typeof rawYear === 'number') {
        parsedYear = Math.floor(rawYear);
      } else if (typeof rawYear === 'string') {
        parsedYear = parseInt(rawYear.replace(/\D/g, ''), 10);
      }

      if (!isNaN(parsedYear) && parsedYear >= 2026 && parsedYear <= maxGraduationYear) {
        updateData.graduationYear = parsedYear;
      } else if (typeof rawYear === 'string' && (rawYear.includes('1st') || rawYear.includes('2nd') || rawYear.includes('3rd') || rawYear.includes('4th'))) {
        if (rawYear.includes('1st')) updateData.graduationYear = currentYear + 3;
        else if (rawYear.includes('2nd')) updateData.graduationYear = currentYear + 2;
        else if (rawYear.includes('3rd')) updateData.graduationYear = currentYear + 1;
        else if (rawYear.includes('4th')) updateData.graduationYear = currentYear;
      } else {
        throw new BadRequestException(`Year of passing must be between 2026 and ${maxGraduationYear}.`);
      }
    }

    if (location !== undefined) updateData.location = location;
    if (profileCompleted !== undefined) updateData.profileCompleted = profileCompleted;
    if (Array.isArray(interests)) updateData.interests = interests.filter(i => typeof i === 'string');

    const realEmail = userEmail && !userEmail.endsWith('@meetifyy.user') ? userEmail.trim().toLowerCase() : (data.email || `${userId}@meetifyy.user`);

    const existingUserRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true, displayName: true },
    });

    const fallbackUsername = updateData.username || existingUserRecord?.username || realEmail.split('@')[0] || `user_${userId.slice(0, 8)}`;
    const fallbackDisplayName = updateData.displayName || existingUserRecord?.displayName || fallbackUsername;

    // Auto-heal email if existing record has fallback
    if (existingUserRecord && (existingUserRecord.email.endsWith('@meetifyy.user') || !existingUserRecord.email) && realEmail && !realEmail.endsWith('@meetifyy.user')) {
      updateData.email = realEmail;
    }

    clearAuthSyncCache(userId);

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

    const updated = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...payload },
      update: { ...payload }
    });

    this.domainEventService.emit('user.settings_updated', { userId, settings: updated }, [userId]);

    // C-4 fix: Immediately evict the cached notification preferences so that any
    // changes to notification opt-in/out take effect on the next notification delivery
    // rather than waiting up to 5 minutes for the TTL to expire.
    this.notificationsService.invalidatePrefsCache(userId).catch(() => {});

    return updated;
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

  async getConnections(userId: string, query?: string, limit: number = 50) {
    const excludedUserIds = await this.blocksService.getExcludedUserIds(userId);
    const excludeSet = new Set([...excludedUserIds, userId]);

    const cleanQuery = (query || '').trim().toLowerCase();
    const whereClause: any = {
      id: { notIn: Array.from(excludeSet) },
      accountStatus: 'ACTIVE',
      ...(cleanQuery
        ? {
            OR: [
              { displayName: { contains: cleanQuery, mode: 'insensitive' } },
              { username: { contains: cleanQuery, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const users = await this.prisma.user.findMany({
      where: whereClause,
      take: limit,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }
}
