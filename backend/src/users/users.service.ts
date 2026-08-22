import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from './blocks.service';
import { PresenceService } from '../presence/presence.service';
import { checkPresenceVisibility, resolvePresenceVisibilityForViewer } from './privacy.helper';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE, FollowNotifJob } from '../notifications/notifications.processor';
import { clearAuthSyncCache } from '../auth/auth.service';
import { validateBirthday } from '../common/utils/birthday-validation.util';
import { AcademicsService } from '../academics/academics.service';

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
    private readonly academicsService: AcademicsService,
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
        isCampusRep: true,
        avatar: true,
        bio: true,
        collegeId: true,
        college: { select: { id: true, name: true } },
        course: true,
        branch: true,
        currentYear: true,
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
        isCampusRep: true,
        avatar: true,
        bio: true,
        collegeId: true,
        course: true,
        branch: true,
        currentYear: true,
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

  /**
   * Server-side campus directory: search + course/branch/currentYear filters with
   * keyset (cursor) pagination on (createdAt desc, id desc). Scoped to the
   * caller's college so a directory can scale past the previous 50-row client
   * cap without ever downloading the whole college. Presence is batched.
   *
   * @param cursor  `${createdAt ISO}|${id}` of the last row from the prior page.
   * @returns { users, nextCursor }
   */
  async getDirectory(
    userId: string,
    opts: { search?: string; course?: string; branch?: string; currentYear?: number; limit?: number; cursor?: string } = {},
  ): Promise<{ users: any[]; nextCursor?: string }> {
    if (!userId) return { users: [], nextCursor: undefined };
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    if (!me?.collegeId) return { users: [], nextCursor: undefined };

    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 50);
    const search = (opts.search || '').trim();

    // Decode keyset cursor.
    let cursorWhere: any = undefined;
    if (opts.cursor && opts.cursor.includes('|')) {
      const [ts, id] = opts.cursor.split('|');
      const createdAt = new Date(ts);
      if (!isNaN(createdAt.getTime()) && id) {
        cursorWhere = {
          OR: [
            { createdAt: { lt: createdAt } },
            { createdAt: createdAt, id: { lt: id } },
          ],
        };
      }
    }

    const where: any = {
      collegeId: me.collegeId,
      id: { not: userId },
      accountStatus: 'ACTIVE',
      deletedAt: null,
      ...(opts.course ? { course: opts.course } : {}),
      ...(opts.branch ? { branch: opts.branch } : {}),
      ...(opts.currentYear ? { currentYear: opts.currentYear } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' as const } },
              { username: { contains: search, mode: 'insensitive' as const } },

            ],
          }
        : {}),
      ...(cursorWhere || {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      take: limit + 1, // fetch one extra to detect the next page
      select: {
        id: true,
        username: true,
        displayName: true,
        isCampusRep: true,
        avatar: true,
        bio: true,
        collegeId: true,
        course: true,
        branch: true,
        currentYear: true,
        createdAt: true,
        settings: { select: { showOnlineStatus: true, whoCanSeeOnline: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : undefined;

    const presenceMap = await this.presenceService.getPresenceMany(pageRows.map(u => u.id));
    const users = pageRows.map(({ createdAt, ...u }) => {
      const pres = presenceMap.get(u.id);
      const isOnline = pres?.status === 'online';
      return { ...u, isOnline, online: isOnline, lastActive: pres?.lastSeen || null };
    });

    return { users, nextCursor };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        isCampusRep: true,
        avatar: true,
        bio: true,
        college: true,
        course: true,
        branch: true,
        currentYear: true,
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

    let isFollowing = false;
    let isFollowedBy = false;

    // All of these are independent of each other, so run them in ONE parallel
    // batch instead of sequentially — collapses the block-check, both follow
    // lookups, presence read and visibility check from ~3-4 sequential
    // backend↔DB round trips into a single round trip's worth of latency.
    const needsRelational = Boolean(currentUserId && currentUserId !== targetUser.id);
    const [blockCount, followRecord, followedByRecord, presence, canSeeOnline] = await Promise.all([
      needsRelational
        ? this.prisma.block.count({
            where: {
              OR: [
                { blockerId: currentUserId!, blockedId: targetUser.id },
                { blockerId: targetUser.id, blockedId: currentUserId! },
              ],
            },
          })
        : Promise.resolve(0),
      needsRelational
        ? this.prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: currentUserId!, followingId: targetUser.id } },
          })
        : Promise.resolve(null),
      needsRelational
        ? this.prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: targetUser.id, followingId: currentUserId! } },
          })
        : Promise.resolve(null),
      this.presenceService.getPresence(targetUser.id),
      checkPresenceVisibility(
        targetUser.id,
        currentUserId || '',
        targetUser.settings?.whoCanSeeOnline || 'everyone',
        targetUser.settings?.showOnlineStatus !== false,
        this.prisma,
      ),
    ]);

    if (blockCount > 0) {
      throw new NotFoundException('User not found');
    }
    isFollowing = !!followRecord;
    isFollowedBy = !!followedByRecord;

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
      collegeId: targetUser.collegeId,
      isCampusRep: targetUser.isCampusRep,
      course: targetUser.course,
      branch: targetUser.branch,
      currentYear: targetUser.currentYear,
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
    const { displayName, username, bio, avatar, cover, location, profileCompleted, interests, birthday } = data;
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
      if (!birthday || typeof birthday !== 'string' || birthday.trim() === '') {
        throw new BadRequestException('Date of birth is required.');
      }
      validateBirthday(birthday);
      updateData.birthday = birthday.trim();
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
    
    // Academic information is validated against the official GLA catalogue on the
    // server, so a handcrafted request cannot pair a course with another course's
    // branch or a year beyond the course duration. Absent fields leave the stored
    // values untouched, which lets a settings save that only edits a bio omit them.
    let academic: { course: string; branch: string; currentYear: number } | null = null;
    try {
      academic = this.academicsService.validateIfPresent({
        course: data.course,
        branch: data.branch,
        currentYear: data.currentYear,
      });
    } catch (err) {
      // Log the rejected combination (ids only — no personal data) so an invalid
      // pairing reaching the server is diagnosable without replaying the request.
      this.logger.warn(
        `[ACADEMIC] rejected for user=${userId} course=${data.course ?? '-'} branch=${data.branch ?? '-'} year=${data.currentYear ?? '-'}: ${(err as Error).message}`,
      );
      throw err;
    }
    if (academic) {
      updateData.course = academic.course;
      updateData.branch = academic.branch;
      updateData.currentYear = academic.currentYear;
      // Debug-level: useful while a user is completing onboarding, silent in prod.
      this.logger.debug(
        `[ACADEMIC] accepted for user=${userId} course=${academic.course} branch=${academic.branch} year=${academic.currentYear}`,
      );
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

    const updated = await this.prisma.user.upsert({
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
        isCampusRep: true,
        avatar: true,
        collegeId: true,
        college: { select: { id: true, name: true } },
        cover: true,
        bio: true,
        birthday: true,
        course: true,
        branch: true,
        currentYear: true,
        location: true,
        interests: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // A changed avatar or cover has to reach everyone else, not just the person
    // who changed it. Both are denormalised into most payloads the app renders
    // — post authors, comment authors, chat participants, member lists, invite
    // and share pickers — so without this every other client kept showing the
    // old image until each of its queries happened to refetch. Fire-and-forget:
    // the profile is already saved, and a realtime failure must not undo that.
    if (avatar !== undefined || cover !== undefined || displayName !== undefined) {
      this.domainEventService.emit('user.updated', {
        // Deliberately `id`, not `userId`: DomainEventService treats a `userId`
        // field as "target only this user", which is the opposite of what this
        // event needs.
        id: updated.id,
        username: updated.username,
        avatar: updated.avatar ?? null,
        cover: updated.cover ?? null,
        displayName: updated.displayName ?? null,
      }).catch((err) => this.logger.warn(`Failed to broadcast user.updated: ${err?.message}`));
    }

    return updated;
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
    // Invalidate cached block lists AND the conversation-list cache for both
    // users so the `blocked` flag / hidden presence reflect the change
    // immediately instead of lingering for the 60s conversation-cache TTL.
    await this.blocksService.invalidateBlockCache(blockerId, blockedId);
    await this.invalidateConversationListCache([blockerId, blockedId]);
    return { success: true, blocked: true };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({
      where: { blockerId, blockedId },
    });
    // Invalidate cached block lists for both users
    await this.blocksService.invalidateBlockCache(blockerId, blockedId);
    await this.invalidateConversationListCache([blockerId, blockedId]);
    return { success: true, blocked: false };
  }

  /**
   * Bust the `user:conversations:*` Redis cache for the given users. Mirrors the
   * key scheme in MessagesService.invalidateUserConversationsCache (page 0 for
   * the common UI page sizes). Kept here to avoid a MessagesService <-> UsersService
   * circular dependency.
   */
  private async invalidateConversationListCache(userIds: string[]) {
    const redis = this.redisService?.getClient?.();
    if (!redis) return;
    const COMMON_LIMITS = [20, 30, 50];
    const keys: string[] = [];
    for (const uid of userIds) {
      for (const lim of COMMON_LIMITS) keys.push(`user:conversations:${uid}:${lim}:0`);
    }
    if (keys.length > 0) await redis.del(...keys).catch(() => {});
  }

  async getConnections(userId: string, query?: string, limit: number = 50) {
    const cleanQuery = (query || '').trim().toLowerCase();

    // Short-lived Redis cache: the invite/share "people" list is opened
    // repeatedly and is identical for a user within a few seconds. This turns
    // repeat modal opens (and each keystroke that repeats an earlier query)
    // into an O(1) cache hit instead of a fresh DB round-trip + pool acquire.
    const redis = this.redisService?.getClient?.();
    const cacheKey = `connections:${userId}:${cleanQuery}:${limit}`;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const excludedUserIds = await this.blocksService.getExcludedUserIds(userId);
    const excludeSet = new Set([...excludedUserIds, userId]);

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
        isCampusRep: true,
        collegeId: true,
        college: { select: { id: true, name: true } },
        avatar: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (redis) {
      // 20s TTL — long enough to make a modal session feel instant, short
      // enough that a new block/signup surfaces quickly.
      redis.setex(cacheKey, 20, JSON.stringify(users)).catch(() => {});
    }

    return users;
  }

  // Candidate pool pulled from the DB before scoring — bounded regardless of
  // how many users match the query, so this never scales with total user count.
  private static readonly MENTION_CANDIDATE_POOL = 50;
  private static readonly MENTION_RECENT_CONVERSATIONS = 10;

  /**
   * Server-side @mention suggestion search. Replaces the old client pattern of
   * fetching the entire user table into the browser and scoring in JS — here
   * only a bounded, already-matched candidate pool (<= 50 rows) ever leaves
   * the DB, and every ranking signal (mutuals, recent chats, community
   * membership) is computed with indexed, batched queries instead of an
   * O(users) client-side loop.
   */
  async getMentionSuggestions(userId: string, query: string, communityId?: string, limit: number = 15) {
    const cleanQuery = (query || '').trim().toLowerCase();

    // Stage 1 — everything that depends on nothing but `userId`. The block
    // lookup used to be awaited on its own before this batch even started,
    // adding a full round-trip to every request; only the candidate query
    // actually needs its result, so it runs here alongside the rest.
    const [excludedUserIds, followingRows, followerRows, communityMemberRows, recentConvs] = await Promise.all([
      this.blocksService.getExcludedUserIds(userId),
      this.prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
      this.prisma.follow.findMany({ where: { followingId: userId }, select: { followerId: true } }),
      communityId
        ? this.prisma.communityMember.findMany({ where: { communityId }, select: { userId: true } })
        : Promise.resolve([] as { userId: string }[]),
      this.prisma.conversationParticipant.findMany({
        where: { userId, deletedAt: null },
        select: { conversationId: true },
        orderBy: { conversation: { updatedAt: 'desc' } },
        take: UsersService.MENTION_RECENT_CONVERSATIONS,
      }),
    ]);

    const excludeSet = new Set([...excludedUserIds, userId]);

    const whereClause: any = {
      id: { notIn: Array.from(excludeSet) },
      accountStatus: 'ACTIVE',
      ...(cleanQuery
        ? {
            OR: [
              { username: { contains: cleanQuery, mode: 'insensitive' } },
              { displayName: { contains: cleanQuery, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const recentConvIds = recentConvs.map((c) => c.conversationId);

    // Stage 2 — the candidate pool (needs the exclusion set) and the
    // recent-chat partners (needs the conversation ids) both become available
    // at the same moment, so they run together instead of one after the other.
    const [candidates, recentParticipants] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        take: UsersService.MENTION_CANDIDATE_POOL,
        select: { id: true, username: true, displayName: true, avatar: true, isCampusRep: true, collegeId: true, college: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      recentConvIds.length > 0
        ? this.prisma.conversationParticipant.findMany({
            where: { conversationId: { in: recentConvIds }, userId: { not: userId } },
            select: { userId: true },
          })
        : Promise.resolve([] as { userId: string }[]),
    ]);

    if (candidates.length === 0) return [];

    const followingIds = followingRows.map((f) => f.followingId);
    const followingSet = new Set(followingIds);
    const followerSet = new Set(followerRows.map((f) => f.followerId));
    const communityMemberSet = new Set(communityMemberRows.map((m) => m.userId));

    const recentChatUserIdSet = new Set(recentParticipants.map((p) => p.userId));

    // Mutual-connection count per candidate: how many people I follow also
    // follow that candidate. One batched query for the whole candidate set
    // instead of an N+1 per-row lookup.
    const candidateIds = candidates.map((c) => c.id);
    const mutualRows = followingIds.length > 0 && candidateIds.length > 0
      ? await this.prisma.follow.findMany({
          where: { followerId: { in: followingIds }, followingId: { in: candidateIds } },
          select: { followingId: true },
        })
      : [];
    const mutualCountMap = new Map<string, number>();
    mutualRows.forEach((m) => mutualCountMap.set(m.followingId, (mutualCountMap.get(m.followingId) || 0) + 1));

    const scored = candidates.map((u) => {
      const uname = u.username.toLowerCase();
      const dname = (u.displayName || '').toLowerCase();
      let score = 0;

      if (cleanQuery && (uname.startsWith(cleanQuery) || dname.startsWith(cleanQuery))) {
        score += 500;
      }

      const isFollowing = followingSet.has(u.id);
      const isFollower = followerSet.has(u.id);
      if (isFollowing && isFollower) score += 10000;
      else if (isFollowing || isFollower) score += 7000;

      if (recentChatUserIdSet.has(u.id)) score += 4000;
      if (communityMemberSet.has(u.id)) score += 2000;

      return {
        user: {
          id: u.id,
          username: u.username,
          displayName: u.displayName || u.username,
          avatar: u.avatar,
          mutualCount: mutualCountMap.get(u.id) || 0,
        },
        score,
      };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.user.displayName.localeCompare(b.user.displayName);
    });

    return scored.slice(0, limit).map((s) => s.user);
  }

  /**
   * "Online Friends" sidebar widget data — mutual connections (I follow them
   * AND they follow me) who are currently online, respecting each user's own
   * presence-visibility settings. Computed entirely server-side and capped to
   * `limit` so the client never has to fetch a page of users and re-derive
   * "is this a mutual, is this a friend" in JS — the client-facing hooks
   * used to pull the 20 most-recently-created accounts (getAllUsers's
   * default) and filter down to online mutuals from *that* set, which meant
   * the widget could easily show zero or the wrong people even when the
   * viewer had online friends outside that arbitrary recent-signup window.
   */
  async getOnlineFriends(userId: string, limit: number = 6) {
    // Mutuals in ONE query. This used to be three sequential round-trips
    // (my following → who of those follows me back → hydrate those users),
    // where each step had to wait for the previous step's id list. Expressing
    // "follows me AND I follow them" as two relation filters lets Postgres do
    // the intersection with the existing Follow indexes and hands back the
    // hydrated rows directly.
    const candidates = await this.prisma.user.findMany({
      where: {
        accountStatus: 'ACTIVE',
        followers: { some: { followerId: userId } },  // I follow them
        following: { some: { followingId: userId } }, // they follow me
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        isCampusRep: true,
        collegeId: true,
        college: { select: { id: true, name: true } },
        avatar: true,
        settings: { select: { showOnlineStatus: true, whoCanSeeOnline: true } },
      },
    });
    if (candidates.length === 0) return [];

    const presenceMap = await this.presenceService.getPresenceMany(candidates.map((u) => u.id));

    // Only bother with a privacy check for users actually reporting online —
    // avoids doing visibility work for the (usually majority) offline mutuals.
    const onlineCandidates = candidates.filter((u) => presenceMap.get(u.id)?.status === 'online');
    if (onlineCandidates.length === 0) return [];

    // One batched visibility resolution instead of a sequential
    // checkPresenceVisibility call per online mutual — that loop re-read the
    // viewer's own userSettings row once per candidate and issued up to two
    // more follow lookups each, all strictly serialized by the `await`.
    const visibleIds = await resolvePresenceVisibilityForViewer(
      userId,
      onlineCandidates.map((u) => ({
        userId: u.id,
        rule: u.settings?.whoCanSeeOnline || 'everyone',
        isEnabled: u.settings?.showOnlineStatus !== false,
      })),
      this.prisma,
    );

    const results: Array<{ id: string; username: string; displayName: string; avatar: string | null; isOnline: true }> = [];
    for (const u of onlineCandidates) {
      if (!visibleIds.has(u.id)) continue;
      results.push({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, isOnline: true });
      if (results.length >= limit) break;
    }

    return results;
  }
}
