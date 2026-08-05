import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Inject, forwardRef, OnModuleInit, Optional } from '@nestjs/common'; 
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ActivitiesService implements OnModuleInit {
  private readonly logger = new Logger(ActivitiesService.name);
  private readonly redis: Redis | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly blocksService: BlocksService,
    private readonly domainEventService: DomainEventService,
    private readonly activityAuthorizationService: ActivityAuthorizationService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notifQueue?: Queue,
  ) {
    this.redis = this.redisService?.getClient() ?? null;
  }


  /** Tag-Set name that tracks all live activity feed cache keys. */
  private static readonly FEED_TAG = 'activities:tag:feed';

  /**
   * Registers a cache key into the tag-Set so it can be found during invalidation.
   * Fire-and-forget — a failure here is non-fatal.
   */
  private registerFeedCacheKey(key: string): void {
    if (!this.redis) return;
    // SADD into the tag Set + cap its lifetime to avoid zombie tags
    this.redis.sadd(ActivitiesService.FEED_TAG, key).catch(() => {});
    this.redis.expire(ActivitiesService.FEED_TAG, 120).catch(() => {}); // 2-min safety TTL on the tag set
  }

  /**
   * Targeted invalidation: fetches only the keys registered in the tag-Set and
   * deletes them in one DEL call. No SCAN of the entire keyspace.
   * Previously: O(total Redis keys) SCAN loop.
   * Now: O(number of live feed keys) — typically < 200 keys.
   */
  private async clearActivityFeedCaches() {
    if (!this.redis) return;
    try {
      const keys = await this.redis.smembers(ActivitiesService.FEED_TAG);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      // Remove the tag set itself so it is cleanly re-seeded on next cache write
      await this.redis.del(ActivitiesService.FEED_TAG);
    } catch {}
  }

  onModuleInit() {
    // Run auto-expiration every 60 seconds
    setInterval(() => {
      this.autoExpireActivities().catch(() => {});
    }, 60000);
  }

  async autoExpireActivities() {
    const now = new Date();
    try {
      const expiredList = await this.prisma.crewActivity.findMany({
        where: {
          status: 'OPEN',
          deletedAt: null,
          OR: [
            { endDate: { lte: now } },
            {
              endDate: null,
              startDate: { lte: new Date(now.getTime() - 3 * 60 * 60 * 1000) }
            }
          ]
        },
        select: { id: true }
      });

      if (expiredList && expiredList.length > 0) {
        const expiredIds = expiredList.map(a => a.id);
        await this.prisma.crewActivity.updateMany({
          where: { id: { in: expiredIds } },
          data: { status: 'ENDED' }
        });

        await this.prisma.activityInvitation.updateMany({
          where: { activityId: { in: expiredIds }, status: 'PENDING' },
          data: { status: 'EXPIRED' }
        });

        for (const actId of expiredIds) {
          this.domainEventService.emit('activity.updated', { id: actId, status: 'ENDED' });
        }
      }
    } catch (err) {
      this.logger.error('Failed to auto-expire activities', err);
    }
  }

  private async resolveCursorDate(cursor?: string): Promise<Date | undefined> {
    if (!cursor) return undefined;

    // 1. Dual tokenized cursor: ISO_DATE|ID
    if (cursor.includes('|')) {
      const datePart = cursor.split('|')[0];
      const parsed = new Date(datePart);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // 2. ISO date string
    const parsed = new Date(cursor);
    if (!isNaN(parsed.getTime()) && (cursor.includes('T') || cursor.includes('-') || !isNaN(Number(cursor)))) {
      return parsed;
    }

    // 3. Fallback for legacy plain ID cursor: Check Redis first
    const cacheKey = `activity:created_at:${cursor}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return new Date(cached);
      } catch {}
    }

    // 4. DB lookup for legacy cursor ID (cached for 1h)
    const record = await this.prisma.crewActivity.findUnique({
      where: { id: cursor },
      select: { createdAt: true },
    });

    if (record?.createdAt) {
      if (this.redis) {
        this.redis.setex(cacheKey, 3600, record.createdAt.toISOString()).catch(() => {});
      }
      return record.createdAt;
    }

    return undefined;
  }

  async getAllActivities(userId?: string, limit = 20, cursor?: string) {
    const startTime = performance.now();
    
    // Tier 1: Check user-specific cache (Instant HIT)
    const userCacheKey = `activities:feed:${userId || 'anon'}:${limit}:${cursor || 'none'}`;
    let tCache = 0;
    if (this.redis) {
      const redisStart = performance.now();
      try {
        const cached = await this.redis.get(userCacheKey);
        tCache = performance.now() - redisStart;
        if (cached) {
          const totalMs = performance.now() - startTime;
          this.logger.log(`[STAGE_TIMINGS] GET /api/activities (HIT) - Total: ${totalMs.toFixed(2)}ms | Redis: ${tCache.toFixed(2)}ms`);
          return JSON.parse(cached);
        }
      } catch {}
    }

    const preFetchStart = performance.now();
    const [excludedUserIds, cursorDate] = await Promise.all([
      userId ? this.blocksService.getExcludedUserIds(userId) : Promise.resolve([]),
      this.resolveCursorDate(cursor),
    ]);
    const tPreFetch = performance.now() - preFetchStart;

    // Tier 2: Check shared base feed cache across all users when no user blocks
    const baseCacheKey = `activities:feed:base:${limit}:${cursorDate ? cursorDate.toISOString() : 'none'}`;
    let baseFeed: { activities: any[]; nextCursor: string | undefined } | null = null;

    if (excludedUserIds.length === 0 && this.redis) {
      try {
        const cachedBase = await this.redis.get(baseCacheKey);
        if (cachedBase) {
          baseFeed = JSON.parse(cachedBase);
        }
      } catch {}
    }

    const dbStart = performance.now();
    let activities: any[];
    let nextCursor: string | undefined = undefined;

    if (baseFeed) {
      activities = baseFeed.activities;
      nextCursor = baseFeed.nextCursor;
    } else {
      await this.autoExpireActivities();
      const now = new Date();
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

      const whereClause: any = {
        deletedAt: null,
        status: 'OPEN',
        startDate: { gt: now },
        visibility: 'PUBLIC',
        ...(excludedUserIds.length > 0 ? { creatorId: { notIn: excludedUserIds } } : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      };

      const fetchedActivities = await this.prisma.crewActivity.findMany({
        where: whereClause,
        take: limit + 1,
        select: {
          id: true,
          creatorId: true,
          title: true,
          description: true,
          location: true,
          maxMembers: true,
          createdAt: true,
          coverImage: true,
          coverMediaId: true,
          createActivityGroup: true,
          deletedAt: true,
          endDate: true,
          latitude: true,
          longitude: true,
          startDate: true,
          status: true,
          updatedAt: true,
          hostCollege: true,
          collegeId: true,
          participationType: true,
          shareToCampus: true,
          visibility: true,
          _count: { select: { members: true } },
          members: {
            take: 5,
            select: {
              userId: true,
              activityId: true,
              joinedAt: true,
              status: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatar: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (fetchedActivities.length > limit) {
        const next = fetchedActivities.pop();
        if (next?.createdAt && next?.id) {
          nextCursor = `${next.createdAt.toISOString()}|${next.id}`;
        }
      }
      activities = fetchedActivities;

      if (excludedUserIds.length === 0 && this.redis) {
        this.redis.setex(baseCacheKey, 60, JSON.stringify({ activities, nextCursor })).catch(() => {});
        this.registerFeedCacheKey(baseCacheKey);
      }
    }
    const tMainDb = performance.now() - dbStart;

    if (activities.length === 0) {
      const emptyRes = { activities: [], nextCursor: undefined };
      if (this.redis) {
        this.redis.setex(userCacheKey, 60, JSON.stringify(emptyRes)).catch(() => {});
        this.registerFeedCacheKey(userCacheKey);
      }
      const totalMs = performance.now() - startTime;
      this.logger.log(`[STAGE_TIMINGS] GET /api/activities (EMPTY) - Total: ${totalMs.toFixed(2)}ms | Redis: ${tCache.toFixed(2)}ms | PreFetch: ${tPreFetch.toFixed(2)}ms | MainDB: ${tMainDb.toFixed(2)}ms`);
      return emptyRes;
    }

    // Scoped membership query: fetch ONLY for the activities returned on this page
    const memberStart = performance.now();
    const activityIds = activities.map(a => a.id);
    const joinedMemberships = userId && activityIds.length > 0
      ? await this.prisma.crewActivityMember.findMany({
          where: { userId, activityId: { in: activityIds } },
          select: { activityId: true, status: true },
        })
      : [];
    const tMemberDb = performance.now() - memberStart;

    const logicStart = performance.now();
    const membershipMap = new Map(joinedMemberships.map(m => [m.activityId, m.status]));

    const response = {
      activities: activities.map(a => {
        const myStatus = membershipMap.get(a.id);
        return {
          ...a,
          isJoined: myStatus === 'MEMBER',
          myStatus: myStatus || null,
        };
      }),
      nextCursor,
    };

    if (this.redis) {
      this.redis.setex(userCacheKey, 60, JSON.stringify(response)).catch(() => {});
      this.registerFeedCacheKey(userCacheKey);
    }
    const tLogic = performance.now() - logicStart;

    const totalMs = performance.now() - startTime;
    this.logger.log(
      `[STAGE_TIMINGS] GET /api/activities - Total: ${totalMs.toFixed(2)}ms | RedisLookup: ${tCache.toFixed(2)}ms | PreFetch: ${tPreFetch.toFixed(2)}ms | BaseCache: ${baseFeed ? 'HIT' : 'MISS'} | MainDB: ${tMainDb.toFixed(2)}ms | MemberDB: ${tMemberDb.toFixed(2)}ms | Logic: ${tLogic.toFixed(2)}ms`
    );

    return response;
  }

  async getCampusActivities(userId: string, limit = 20, cursor?: string) {
    if (!userId) return { activities: [], nextCursor: undefined };

    const cacheKey = `activities:campus:${userId}:${limit}:${cursor || 'none'}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const [excludedUserIds, user, cursorDate, joinedMemberships] = await Promise.all([
      this.blocksService.getExcludedUserIds(userId),
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, collegeId: true } }),
      cursor ? this.prisma.crewActivity.findUnique({ where: { id: cursor }, select: { createdAt: true } }).then(r => r?.createdAt) : Promise.resolve(undefined),
      this.prisma.crewActivityMember.findMany({ where: { userId }, select: { activityId: true, status: true } }),
    ]);

    if (!user?.collegeId) return { activities: [], nextCursor: undefined };

    const joinedActivityIds = joinedMemberships.map(m => m.activityId);
    const membershipMap = new Map(joinedMemberships.map(m => [m.activityId, m.status]));

    await this.autoExpireActivities();
    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

    const whereClause: any = {
      deletedAt: null,
      collegeId: user.collegeId,
      status: 'OPEN',
      startDate: { gt: now },
      AND: [
        {
          OR: [
            { visibility: 'COLLEGE_ONLY' },
            { shareToCampus: true }
          ]
        }
      ],
      ...(excludedUserIds.length > 0 ? { creatorId: { notIn: excludedUserIds } } : {}),
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    };

    const activities = await this.prisma.crewActivity.findMany({
      where: whereClause,
      take: limit + 1,
      include: {
        _count: { select: { members: true } },
        members: {
          take: 5,
          include: { 
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true
              }
            }
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let nextCursor: string | undefined = undefined;
    if (activities.length > limit) {
      const next = activities.pop();
      nextCursor = next?.id;
    }

    if (activities.length === 0) {
      const emptyRes = { activities: [], nextCursor: undefined };
      if (this.redis) {
        this.redis.setex(cacheKey, 60, JSON.stringify(emptyRes)).catch(() => {});
        this.registerFeedCacheKey(cacheKey);
      }
      return emptyRes;
    }

    const response = {
      activities: activities.map(a => {
        const myStatus = membershipMap.get(a.id);
        return {
          ...a,
          isJoined: myStatus === 'MEMBER',
          myStatus: myStatus || null,
        };
      }),
      nextCursor,
    };

    if (this.redis) {
      this.redis.setex(cacheKey, 60, JSON.stringify(response)).catch(() => {});
      this.registerFeedCacheKey(cacheKey);
    }

    return response;
  }

  async getActivityById(id: string, userId?: string) {
    const cleanId = id ? id.replace(/^(act_)+/, '') : id;
    const [activity, user, excludedUserIds] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: cleanId },
        include: {
          members: {
            include: { user: { select: { id: true, username: true, displayName: true, avatar: true } } }
          },
          invitations: { select: { inviteeId: true, status: true } },
          creator: { select: { id: true, username: true, displayName: true, avatar: true } },
        },
      }),
      userId ? this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, collegeId: true } }) : Promise.resolve(null),
      userId ? this.blocksService.getExcludedUserIds(userId) : Promise.resolve([]),
    ]);

    if (!activity || (excludedUserIds.length > 0 && excludedUserIds.includes(activity.creatorId))) {
      throw new NotFoundException('Activity not found');
    }

    const viewDecision = this.activityAuthorizationService.canView(user, activity as any);
    if (!viewDecision.allowed) {
      throw new ForbiddenException(viewDecision.reason || 'Not authorized to view activity');
    }

    const joinDecision = user
      ? this.activityAuthorizationService.canJoin(user, activity as any)
      : { allowed: false, reason: 'Login required', code: 'NOT_FOUND' as const };

    const myMembership = userId ? activity.members.find(m => m.userId === userId) : null;
    return {
      ...activity,
      isJoined: myMembership?.status === 'MEMBER',
      myStatus: myMembership?.status || null,
      canJoin: joinDecision.allowed,
      joinRestrictionReason: joinDecision.reason || null,
      joinRestrictionCode: joinDecision.code || 'ALLOWED',
    };
  }

  async createActivity(data: any, creatorId: string) {
    if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
      throw new BadRequestException('Title is required');
    }
    if (data.title.trim().length > 30) {
      throw new BadRequestException('Title cannot exceed 30 characters');
    }
    if (data.description && data.description.length > 500) {
      throw new BadRequestException('Description cannot exceed 500 characters');
    }
    if (data.location && data.location.length > 100) {
      throw new BadRequestException('Location cannot exceed 100 characters');
    }
    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('Invalid start or end date');
      }
      if (end <= start) {
        throw new BadRequestException('End date must be after start date');
      }
      const maxDurationMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (end.getTime() - start.getTime() > maxDurationMs) {
        throw new BadRequestException('Activity duration cannot exceed 30 days');
      }
    }

    let visibility: 'PUBLIC' | 'COLLEGE_ONLY' | 'PRIVATE' = 'PUBLIC';
    if (data.visibility === 'COLLEGE_ONLY' || data.visibility === 'PRIVATE' || data.visibility === 'PUBLIC') {
      visibility = data.visibility;
    } else if (data.whoCanJoin === 'College' || data.shareToCampus) {
      visibility = 'COLLEGE_ONLY';
    } else if (data.whoCanJoin === 'No one') {
      visibility = 'PRIVATE';
    }

    const user = await this.prisma.user.findUnique({ where: { id: creatorId }, select: { collegeId: true } });

    const createData: any = {
      creatorId,
      title: data.title,
      description: data.description,
      coverImage: data.coverImage,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      location: data.location,
      createActivityGroup: data.createActivityGroup,
      maxMembers: data.maxMembers ? parseInt(data.maxMembers, 10) : null,
      visibility,
      shareToCampus: visibility === 'COLLEGE_ONLY' || Boolean(data.shareToCampus),
      collegeId: user?.collegeId || null,
      members: {
        create: [{ userId: creatorId, status: 'MEMBER' }],
      },
    };

    const createdActivity = await this.prisma.crewActivity.create({
      data: createData,
      select: {
        id: true,
        creatorId: true,
        title: true,
        description: true,
        coverImage: true,
        startDate: true,
        endDate: true,
        location: true,
        status: true,
        visibility: true,
        shareToCampus: true,
        createActivityGroup: true,
        maxMembers: true,
        createdAt: true,
        updatedAt: true,
        members: {
          take: 5,
          select: {
            userId: true,
            status: true,
            user: {
              select: { id: true, username: true, displayName: true, avatar: true }
            }
          }
        }
      }
    });

    setImmediate(async () => {
      if (createdActivity.createActivityGroup) {
        const convId = `act_${createdActivity.id}`;
        await this.prisma.conversation.upsert({
          where: { id: convId },
          update: { name: createdActivity.title, avatarKey: createdActivity.coverImage },
          create: {
            id: convId,
            name: createdActivity.title,
            avatarKey: createdActivity.coverImage,
            type: 'GROUP',
            isActivityChat: true,
            activityId: createdActivity.id,
            ownerId: creatorId,
            participants: {
              create: [{ userId: creatorId, role: 'OWNER' }]
            },
            messages: {
              create: [{
                senderId: creatorId,
                payload: { text: 'Activity group chat created' },
                type: 'SYSTEM'
              }]
            }
          }
        }).catch(() => {});
      }
      this.domainEventService.emit('activity.created', { id: createdActivity.id, creatorId, collegeId: user?.collegeId || null });
      this.clearActivityFeedCaches();
    });

    return createdActivity;
  }

  async joinActivity(activityId: string, userId: string): Promise<any> {
    const [activity, user] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: activityId },
        include: {
          members: true,
          invitations: { select: { inviteeId: true, status: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, collegeId: true },
      }),
    ]);

    if (!activity || activity.deletedAt) {
      throw new NotFoundException('Activity not found');
    }

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const startRaw = activity.startDate || (activity as any).date;
    if (startRaw && new Date(startRaw) <= new Date()) {
      throw new BadRequestException('Activity has already started and cannot be joined');
    }

    const existingMember = activity.members.find(m => m.userId === userId);
    if (existingMember) {
      if (existingMember.status === 'MEMBER') throw new BadRequestException('Already a member of this activity');
      if (existingMember.status === 'PENDING') throw new BadRequestException('Join request already pending');
    }

    const authDecision = this.activityAuthorizationService.canJoin(user, activity as any);
    if (!authDecision.allowed) {
      throw new ForbiddenException(authDecision.reason || 'You are not authorized to join this activity');
    }

    await this.prisma.crewActivityMember.upsert({
      where: { userId_activityId: { userId, activityId } },
      update: { status: 'MEMBER' },
      create: { userId, activityId, status: 'MEMBER' },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, username: true, avatar: true }
    });

    if (activity.createActivityGroup) {
      try {
        const convId = `act_${activityId}`;
        const userHandle = actor?.username ? `@${actor.username}` : (actor?.displayName || 'Someone');

        // Ensure conversation record exists
        await this.prisma.conversation.upsert({
          where: { id: convId },
          update: { name: activity.title },
          create: {
            id: convId,
            name: activity.title,
            avatarKey: activity.coverImage,
            type: 'GROUP',
            isActivityChat: true,
            activityId: activity.id,
            ownerId: activity.creatorId,
            participants: {
              create: [{ userId: activity.creatorId, role: 'OWNER' }]
            }
          }
        }).catch(() => {});

        await this.prisma.conversationParticipant.upsert({
          where: { userId_conversationId: { userId, conversationId: convId } },
          update: { role: 'MEMBER', leftAt: null, deletedAt: null } as any,
          create: { conversationId: convId, userId, role: 'MEMBER' }
        }).catch(() => {});

        const sysMsg = await this.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: userId,
            payload: { text: `${userHandle} joined the activity` },
            type: 'SYSTEM'
          }
        }).catch(() => null);

        if (sysMsg) {
          const formattedMsg = {
            id: sysMsg.id,
            conversationId: convId,
            publicId: convId,
            internalId: convId,
            senderId: userId,
            senderName: 'System',
            senderAvatar: '',
            from: 'them',
            createdAt: sysMsg.createdAt,
            timestamp: sysMsg.createdAt,
            time: new Date(sysMsg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'system',
            text: `${userHandle} joined the activity`,
            payload: { text: `${userHandle} joined the activity` },
            status: 'sent'
          };

          const membersList = await this.prisma.crewActivityMember.findMany({
            where: { activityId },
            select: { userId: true }
          }).catch(() => []);

          const participantsList = await this.prisma.conversationParticipant.findMany({
            where: { conversationId: convId, leftAt: null, deletedAt: null } as any,
            select: { userId: true }
          }).catch(() => []);

          const recipientUserIds = Array.from(new Set([
            userId,
            activity.creatorId,
            ...membersList.map(m => m.userId),
            ...participantsList.map(p => p.userId)
          ].filter(Boolean)));

          this.domainEventService.emit('message:new', formattedMsg, recipientUserIds);
          this.domainEventService.emit('conversation:updated', {
            conversationId: convId,
            publicId: convId,
            internalId: convId,
            lastMessage: {
              text: `${userHandle} joined the activity`,
              createdAt: sysMsg.createdAt,
              senderId: userId
            }
          }, recipientUserIds);
        }
      } catch (err) {
        this.logger.warn('Failed group chat update during joinActivity', err);
      }
    }

    this.domainEventService.emit('activity.memberJoined', { activityId, userId });
    this.clearActivityFeedCaches();
    return { success: true };
  }

  async leaveActivity(activityId: string, userId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: { creatorId: true, createActivityGroup: true, title: true, coverImage: true, startDate: true, status: true },
    });

    if (activity && activity.creatorId === userId) {
      throw new BadRequestException('Host cannot leave their own activity');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true }
    });

    const existingMember = await this.prisma.crewActivityMember.findUnique({
      where: { userId_activityId: { userId, activityId } }
    });

    if (existingMember) {
      await this.prisma.crewActivityMember.delete({
        where: { userId_activityId: { userId, activityId } }
      });

      // Broadcast a system message to the group chat if one exists.
      // NOTE: leaving the activity does NOT remove the user from the group chat —
      // they stay in the conversation. Only leaving via the group chat itself removes them.
      if (activity?.createActivityGroup) {
        try {
          const convId = `act_${activityId}`;
          const userHandle = actor?.username ? `@${actor.username}` : (actor?.displayName || 'Someone');

          const sysMsg = await this.prisma.message.create({
            data: {
              conversationId: convId,
              senderId: userId,
              payload: { text: `${userHandle} left the activity` },
              type: 'SYSTEM'
            }
          }).catch(() => null);

          if (sysMsg) {
            const formattedMsg = {
              id: sysMsg.id,
              conversationId: convId,
              publicId: convId,
              internalId: convId,
              senderId: userId,
              senderName: 'System',
              senderAvatar: '',
              from: 'them',
              createdAt: sysMsg.createdAt,
              timestamp: sysMsg.createdAt,
              time: new Date(sysMsg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              type: 'system',
              text: `${userHandle} left the activity`,
              payload: { text: `${userHandle} left the activity` },
              status: 'sent'
            };

            const participantsList = await this.prisma.conversationParticipant.findMany({
              where: { conversationId: convId, leftAt: null, deletedAt: null } as any,
              select: { userId: true }
            }).catch(() => []);

            const recipientUserIds = Array.from(new Set([
              activity?.creatorId,
              ...participantsList.map(p => p.userId)
            ].filter(Boolean))) as string[];

            this.domainEventService.emit('message:new', formattedMsg, recipientUserIds);
            this.domainEventService.emit('conversation:updated', {
              conversationId: convId,
              publicId: convId,
              internalId: convId,
              lastMessage: {
                text: `${userHandle} left the activity`,
                createdAt: sysMsg.createdAt,
                senderId: userId
              }
            }, recipientUserIds);
          }
        } catch (err) {
          this.logger.warn('Failed group chat system message during leaveActivity', err);
        }
      }
    }

    this.domainEventService.emit('activity.memberLeft', { activityId, userId });
    this.clearActivityFeedCaches();
    return { success: true };
  }

  async requestToJoinActivity(activityId: string, userId: string): Promise<any> {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      include: { members: true }
    });
    if (!activity) throw new NotFoundException('Activity not found');
    if (activity.status !== 'OPEN') throw new BadRequestException('Activity not open');

    const startRaw = activity.startDate || (activity as any).date;
    if (startRaw && new Date(startRaw) <= new Date()) {
      throw new BadRequestException('Activity has already started and cannot be joined');
    }

    if (activity.participationType === 'OPEN') {
      return this.joinActivity(activityId, userId);
    }

    // participationType === 'APPROVAL'
    await this.prisma.crewActivityMember.upsert({
      where: { userId_activityId: { userId, activityId } },
      update: { status: 'PENDING' },
      create: { userId, activityId, status: 'PENDING' }
    });

    this.domainEventService.emit('activity.updated', { id: activityId });

    return { success: true, pending: true };
  }

  async acceptJoinRequest(activityId: string, currentUserId: string, requesterId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, creatorId: currentUserId }
    });
    if (!activity) throw new NotFoundException('Activity not found or you are not creator');

    await this.prisma.crewActivityMember.update({
      where: { userId_activityId: { userId: requesterId, activityId } },
      data: { status: 'MEMBER' }
    });

    if (activity.createActivityGroup) {
      const convId = `act_${activityId}`;
      const actor = await this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { displayName: true, username: true }
      });
      const userHandle = actor?.username ? `@${actor.username}` : (actor?.displayName || 'Someone');

      await this.prisma.conversationParticipant.upsert({
        where: { userId_conversationId: { userId: requesterId, conversationId: convId } },
        update: { role: 'MEMBER' },
        create: { conversationId: convId, userId: requesterId, role: 'MEMBER' }
      }).catch(() => {});

      await this.prisma.message.create({
        data: {
          conversationId: convId,
          senderId: requesterId,
          payload: { text: `${userHandle} joined the activity` },
          type: 'SYSTEM'
        }
      }).catch(() => {});
    }

    this.domainEventService.emit('activity.memberJoined', { activityId, userId: requesterId });
    this.clearActivityFeedCaches();
    return { success: true };
  }

  async rejectJoinRequest(activityId: string, currentUserId: string, requesterId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, creatorId: currentUserId }
    });
    if (!activity) throw new NotFoundException('Activity not found or you are not creator');

    await this.prisma.crewActivityMember.update({
      where: { userId_activityId: { userId: requesterId, activityId } },
      data: { status: 'DECLINED' }
    });
    
    this.domainEventService.emit('activity.updated', { id: activityId });
    return { success: true };
  }

  async declineCrewInvitation(activityId: string, userId: string) {
    const invitation = await this.prisma.activityInvitation.findFirst({
      where: {
        activityId,
        inviteeId: userId,
        status: 'PENDING',
      },
    });

    if (invitation) {
      return this.declineInvitation(invitation.id, userId);
    }

    await this.prisma.crewActivityMember.updateMany({
      where: { activityId, userId, status: 'PENDING' },
      data: { status: 'DECLINED' }
    });
    this.domainEventService.emit('activity.updated', { id: activityId });
    return { success: true };
  }

  async cancelCrewActivity(activityId: string, currentUserId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, creatorId: currentUserId },
      select: { id: true }
    });
    if (!activity) throw new NotFoundException('Activity not found or you are not creator');

    await Promise.all([
      this.prisma.crewActivity.update({
        where: { id: activityId },
        data: { status: 'CANCELLED' }
      }),
      this.prisma.activityInvitation.updateMany({
        where: { activityId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      }),
      this.prisma.conversation.updateMany({
        where: { activityId },
        data: { status: 'Closed' }
      })
    ]);

    setImmediate(async () => {
      this.domainEventService.emit('activity.updated', { id: activityId, status: 'CANCELLED' });
      this.clearActivityFeedCaches();
      try {
        const convs = await this.prisma.conversation.findMany({ where: { activityId }, select: { id: true } });
        for (const conv of convs) {
          this.domainEventService.emit('conversation:updated', { conversationId: conv.id });
        }
      } catch (e) {
        // ignore
      }
    });

    return { success: true };
  }

  async endCrewActivity(activityId: string, currentUserId: string) {
    return this.cancelCrewActivity(activityId, currentUserId);
  }

  async bookmarkActivity(activityId: string, userId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, deletedAt: null }
    });
    if (!activity) throw new NotFoundException('Activity not found');

    await this.prisma.activityBookmark.upsert({
      where: { userId_activityId: { userId, activityId } },
      create: { userId, activityId },
      update: {}
    });

    return { success: true, isBookmarked: true, activityId };
  }

  async unbookmarkActivity(activityId: string, userId: string) {
    const existing = await this.prisma.activityBookmark.findUnique({
      where: { userId_activityId: { userId, activityId } }
    });
    if (existing) {
      await this.prisma.activityBookmark.delete({
        where: { userId_activityId: { userId, activityId } }
      });
    }
    return { success: true, isBookmarked: false, activityId };
  }

  async getSavedActivityIds(userId: string) {
    const bookmarks = await this.prisma.activityBookmark.findMany({
      where: { userId },
      select: { activityId: true },
      orderBy: { createdAt: 'desc' }
    });
    return bookmarks.map(b => b.activityId);
  }

  async getMyActivities(userId: string) {
    const memberships = await this.prisma.crewActivityMember.findMany({
      where: { userId, status: 'MEMBER' },
      select: { activityId: true }
    });
    const memberActivityIds = memberships.map(m => m.activityId);

    const activities = await this.prisma.crewActivity.findMany({
      where: {
        deletedAt: null,
        OR: [
          { creatorId: userId },
          { id: { in: memberActivityIds } }
        ]
      },
      include: {
        _count: { select: { members: true } },
        members: {
          take: 5,
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return activities.map(a => ({
      ...a,
      isJoined: true,
      myStatus: 'MEMBER'
    }));
  }

  async getSavedActivities(userId: string, limit = 20, cursor?: string) {
    const excludedUserIds = await this.blocksService.getExcludedUserIds(userId);

    let cursorDate: Date | undefined;
    if (cursor) {
      const cursorBookmark = await this.prisma.activityBookmark.findFirst({
        where: { userId, activityId: cursor },
        select: { createdAt: true }
      });
      if (cursorBookmark) cursorDate = cursorBookmark.createdAt;
    }

    const bookmarks = await this.prisma.activityBookmark.findMany({
      where: {
        userId,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        activity: {
          deletedAt: null,
          creatorId: { notIn: excludedUserIds }
        }
      },
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        activity: {
          include: {
            _count: { select: { members: true } },
            members: {
              take: 5,
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatar: true
                  }
                }
              }
            }
          }
        }
      }
    });

    let nextCursor: string | null = null;
    if (bookmarks.length > limit) {
      const nextItem = bookmarks.pop();
      nextCursor = nextItem?.activityId || null;
    }

    const rawActs = bookmarks.map(b => b.activity).filter(Boolean);

    const myMemberships = await this.prisma.crewActivityMember.findMany({
      where: { userId, activityId: { in: rawActs.map(a => a.id) } }
    });
    const membershipMap = new Map(myMemberships.map(m => [m.activityId, m.status]));

    const formattedActivities = rawActs.map(act => {
      const members = act.members || [];
      const hostMember = members.find(m => m.user?.id === act.creatorId);
      const hostUser = hostMember?.user;

      const userStatus = membershipMap.get(act.id);
      const isJoined = userStatus === 'MEMBER';
      const isPending = userStatus === 'PENDING';

      return {
        id: act.id,
        creatorId: act.creatorId,
        title: act.title,
        description: act.description,
        location: act.location,
        maxMembers: act.maxMembers,
        createdAt: act.createdAt,
        startDate: act.startDate,
        endDate: act.endDate,
        status: act.status,
        coverImage: act.coverImage,
        participationType: act.participationType,
        shareToCampus: act.shareToCampus,
        collegeId: act.collegeId,
        hostCollege: act.hostCollege,
        hostName: hostUser?.displayName || hostUser?.username || 'Host',
        hostAvatar: hostUser?.avatar,
        hostUsername: hostUser?.username,
        slotsNeeded: act.maxMembers || 0,
        slotsFilled: act._count?.members || members.length,
        participants: members.map(m => m.user?.id).filter(Boolean),
        _membersData: members.map(m => m.user).filter(Boolean),
        isJoined,
        isPending,
        isBookmarked: true
      };
    });

    return {
      activities: formattedActivities,
      nextCursor
    };
  }

  async inviteFriends(activityId: string, inviterId: string, inviteeIds: string[]) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        creatorId: true,
        status: true,
        deletedAt: true,
        title: true,
        location: true,
        coverImage: true,
        startDate: true,
        endDate: true,
        members: { select: { userId: true } },
      },
    });

    if (!activity || activity.deletedAt) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.creatorId !== inviterId) {
      throw new BadRequestException('Only the activity creator can invite friends');
    }

    if (activity.status !== 'OPEN') {
      throw new BadRequestException('Activity is not open for invitations');
    }

    const cleanInviteeIds = Array.from(new Set((inviteeIds || []).filter(id => id && id !== inviterId)));
    if (cleanInviteeIds.length === 0) {
      return { results: [] };
    }

    const [inviter, excludedUserIds, existingInvitations] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: inviterId },
        select: { id: true, displayName: true, username: true, avatar: true },
      }),
      this.blocksService.getExcludedUserIds(inviterId),
      this.prisma.activityInvitation.findMany({
        where: {
          activityId,
          inviteeId: { in: cleanInviteeIds },
        },
      }),
    ]);

    const existingMembers = new Set(activity.members.map(m => m.userId));
    const invitationMap = new Map(existingInvitations.map(inv => [inv.inviteeId, inv]));
    const excludedSet = new Set(excludedUserIds);
    const results: any[] = [];
    const inviteesToProcess: string[] = [];
    const fourHoursMs = 4 * 60 * 60 * 1000;

    for (const inviteeId of cleanInviteeIds) {
      if (existingMembers.has(inviteeId)) {
        results.push({ inviteeId, status: 'MEMBER', message: 'User is already a participant' });
        continue;
      }

      const existingInv = invitationMap.get(inviteeId);
      if (existingInv) {
        if (existingInv.status === 'PENDING') {
          results.push({ inviteeId, status: 'PENDING', message: 'Invitation Pending' });
          continue;
        }

        if (existingInv.status === 'DECLINED' && existingInv.respondedAt) {
          const timeSinceDecline = Date.now() - new Date(existingInv.respondedAt).getTime();
          if (timeSinceDecline < fourHoursMs) {
            const remainingMins = Math.ceil((fourHoursMs - timeSinceDecline) / 60000);
            results.push({
              inviteeId,
              status: 'COOLDOWN',
              message: `User recently declined. Cooldown active (${remainingMins} mins left)`,
            });
            continue;
          }
        }
      }

      if (excludedSet.has(inviteeId)) {
        results.push({ inviteeId, status: 'BLOCKED', message: 'Cannot invite user' });
        continue;
      }

      inviteesToProcess.push(inviteeId);
    }

    if (inviteesToProcess.length > 0) {
      await this.prisma.activityInvitation.createMany({
        data: inviteesToProcess.map(inviteeId => ({
          activityId,
          inviterId,
          inviteeId,
          status: 'PENDING',
        })),
        skipDuplicates: true,
      });

      const createdInvitations = await this.prisma.activityInvitation.findMany({
        where: { activityId, inviteeId: { in: inviteesToProcess } },
        select: { id: true, inviteeId: true },
      });

      for (const inv of createdInvitations) {
        results.push({ inviteeId: inv.inviteeId, status: 'INVITED', invitationId: inv.id });
      }

      if (this.notifQueue) {
        setImmediate(() => {
          this.notifQueue?.add('activity-invitations', {
            activityId: activity.id,
            inviterId,
            invitations: createdInvitations.map(i => ({ inviteeId: i.inviteeId, invitationId: i.id })),
            activityTitle: activity.title,
            activityLocation: activity.location,
            activityCoverImage: activity.coverImage,
            startDate: activity.startDate,
            endDate: activity.endDate,
            inviter: {
              id: inviter?.id || inviterId,
              name: inviter?.displayName || inviter?.username || 'Host',
              username: inviter?.username || '',
              avatar: inviter?.avatar,
            },
          }, { removeOnComplete: true, attempts: 3, backoff: { type: 'exponential', delay: 1000 } }).catch(err => {
            this.logger.warn('Failed to enqueue activity invitations job to BullMQ', err);
          });
        });
      }
    }

    return { results };
  }

  async getPendingInvitations(userId: string) {
    const invitations = await this.prisma.activityInvitation.findMany({
      where: {
        inviteeId: userId,
        status: 'PENDING',
        activity: {
          deletedAt: null,
        },
      },
      include: {
        inviter: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        activity: {
          include: {
            _count: { select: { members: true } },
            members: {
              take: 5,
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map(inv => ({
      id: inv.id,
      activityId: inv.activityId,
      title: inv.activity.title,
      description: inv.activity.description,
      location: inv.activity.location,
      coverImage: inv.activity.coverImage,
      startDate: inv.activity.startDate,
      endDate: inv.activity.endDate,
      status: inv.status,
      activityStatus: inv.activity.status,
      createdAt: inv.createdAt,
      hostId: inv.inviter.id,
      hostName: inv.inviter.displayName || inv.inviter.username,
      hostUsername: inv.inviter.username,
      hostAvatar: inv.inviter.avatar,
      participantsCount: inv.activity._count.members,
      sampleParticipants: inv.activity.members.map(m => m.user).filter(Boolean),
    }));
  }

  async acceptInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.activityInvitation.findUnique({
      where: { id: invitationId },
      include: { activity: true },
    });

    if (!invitation || invitation.inviteeId !== userId || invitation.status !== 'PENDING') {
      throw new NotFoundException('Invitation not found or no longer pending');
    }

    await this.joinActivity(invitation.activityId, userId);

    await this.prisma.activityInvitation.update({
      where: { id: invitationId },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
      },
    });

    await this.notificationsService.cancelNotificationByCriteria({
      recipientId: userId,
      entityId: invitation.activityId,
      type: 'ACTIVITY_INVITE' as any,
    }).catch(() => {});

    this.domainEventService.emit('invitation:updated', {
      invitationId,
      status: 'ACCEPTED',
      activityId: invitation.activityId,
    }, [invitation.inviterId, userId]);

    return { success: true, activityId: invitation.activityId };
  }

  async declineInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.activityInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation || invitation.inviteeId !== userId || invitation.status !== 'PENDING') {
      throw new NotFoundException('Invitation not found or no longer pending');
    }

    await this.prisma.activityInvitation.update({
      where: { id: invitationId },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
      },
    });

    await this.notificationsService.cancelNotificationByCriteria({
      recipientId: userId,
      entityId: invitation.activityId,
      type: 'ACTIVITY_INVITE' as any,
    }).catch(() => {});

    this.domainEventService.emit('invitation:updated', {
      invitationId,
      status: 'DECLINED',
      activityId: invitation.activityId,
    }, [invitation.inviterId, userId]);

    return { success: true };
  }

  async getInvitationStatuses(activityId: string, hostId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        members: { select: { userId: true } },
        invitations: { select: { inviteeId: true, status: true, respondedAt: true } },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    const memberSet = new Set(activity.members.map(m => m.userId));
    const fourHoursMs = 4 * 60 * 60 * 1000;

    const statuses: Record<string, { status: string; remainingMins?: number }> = {};

    for (const m of activity.members) {
      statuses[m.userId] = { status: 'MEMBER' };
    }

    for (const inv of activity.invitations) {
      if (memberSet.has(inv.inviteeId)) {
        statuses[inv.inviteeId] = { status: 'MEMBER' };
        continue;
      }

      if (inv.status === 'PENDING') {
        statuses[inv.inviteeId] = { status: 'PENDING' };
      } else if (inv.status === 'DECLINED' && inv.respondedAt) {
        const timeSinceDecline = Date.now() - new Date(inv.respondedAt).getTime();
        if (timeSinceDecline < fourHoursMs) {
          const remainingMins = Math.ceil((fourHoursMs - timeSinceDecline) / 60000);
          statuses[inv.inviteeId] = { status: 'COOLDOWN', remainingMins };
        } else {
          statuses[inv.inviteeId] = { status: 'EXPIRED_DECLINE' };
        }
      } else {
        statuses[inv.inviteeId] = { status: inv.status };
      }
    }

    return statuses;
  }
}
