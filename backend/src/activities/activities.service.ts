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

  /**
   * Scoped feed. `scope` selects which slice of activities to return:
   *   - 'public'      → visibility PUBLIC (default, the "Recent" feed)
   *   - 'college'     → visibility COLLEGE_ONLY for the caller's own college
   *   - 'one_on_one'  → public activities with exactly 2 slots
   * All scopes only ever return OPEN, not-yet-started, non-deleted activities.
   */
  async getAllActivities(
    userId?: string,
    limit = 20,
    cursor?: string,
    scope: 'public' | 'college' | 'one_on_one' = 'public',
  ) {
    const startTime = performance.now();

    // College scope needs the caller's collegeId to filter; resolve it up front.
    // A user with no college has nothing to show in this scope.
    let scopeCollegeId: string | null = null;
    if (scope === 'college') {
      if (!userId) return { activities: [], nextCursor: undefined };
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeId: true },
      });
      scopeCollegeId = u?.collegeId ?? null;
      if (!scopeCollegeId) return { activities: [], nextCursor: undefined };
    }

    // ── Tier 1: user-specific cache ──────────────────────────────────────────
    const scopeTag = scope === 'college' ? `college:${scopeCollegeId}` : scope;
    const userCacheKey = `activities:feed:${scopeTag}:${userId || 'anon'}:${limit}:${cursor || 'none'}`;
    const baseCacheKey = `activities:feed:base:${scopeTag}:${limit}:${cursor || 'none'}`;
    // Base-feed sharing across users is only sound for the anonymous public feed;
    // scoped feeds always resolve per-user to keep membership/college correct.
    const allowBaseCache = scope === 'public';
    let tCache = 0;

    if (this.redis) {
      const redisStart = performance.now();
      try {
        // Fetch both user-specific and base cache in ONE round-trip
        const [userCached, baseCached] = await this.redis.mget(userCacheKey, baseCacheKey);
        tCache = performance.now() - redisStart;

        if (userCached) {
          this.logger.log(`[STAGE_TIMINGS] GET /api/activities (USER_HIT) - Total: ${(performance.now() - startTime).toFixed(2)}ms | Redis: ${tCache.toFixed(2)}ms`);
          return JSON.parse(userCached);
        }

        // If base cache exists and user has no blocks (we assume no-blocks for anon/fast path),
        // we'll check blocks in parallel below — store baseCached for later.
        if (baseCached && allowBaseCache) {
          // Still need to check blocks before we can use it — fall through with a hint
          (this as any)._cachedBase = baseCached;
        }
      } catch {
        tCache = performance.now() - redisStart;
      }
    }

    // ── PreFetch: blocks + cursor resolution in ONE parallel round-trip ───────
    const preFetchStart = performance.now();
    const [excludedUserIds, cursorDate] = await Promise.all([
      userId ? this.blocksService.getExcludedUserIds(userId) : Promise.resolve([]),
      this.resolveCursorDate(cursor),
    ]);
    const tPreFetch = performance.now() - preFetchStart;

    // ── Tier 2: base feed cache (shared across users with no blocks) ──────────
    let baseFeed: { activities: any[]; nextCursor: string | undefined } | null = null;
    if (allowBaseCache && excludedUserIds.length === 0 && this.redis) {
      const hint = (this as any)._cachedBase;
      delete (this as any)._cachedBase;
      if (hint) {
        try { baseFeed = JSON.parse(hint); } catch {}
      } else {
        try {
          // Key changed: use resolved cursorDate for correctness
          const resolvedBaseKey = `activities:feed:base:${scopeTag}:${limit}:${cursorDate ? cursorDate.toISOString() : 'none'}`;
          const cachedBase = await this.redis.get(resolvedBaseKey);
          if (cachedBase) baseFeed = JSON.parse(cachedBase);
        } catch {}
      }
    } else {
      delete (this as any)._cachedBase;
    }

    // ── Main DB fetch (skipped on base cache HIT) ─────────────────────────────
    const dbStart = performance.now();
    let activities: any[];
    let nextCursor: string | undefined;

    if (baseFeed) {
      activities = baseFeed.activities;
      nextCursor = baseFeed.nextCursor;
    } else {
      // Auto-expire is a background concern — fire it async, never block the request
      setImmediate(() => { this.autoExpireActivities().catch(() => {}); });

      const now = new Date();
      const whereClause: any = {
        deletedAt: null,
        status: 'OPEN',
        startDate: { gt: now },
        ...(scope === 'college'
          ? { visibility: 'COLLEGE_ONLY', collegeId: scopeCollegeId }
          : { visibility: 'PUBLIC' }),
        ...(scope === 'one_on_one' ? { maxMembers: 2 } : {}),
        ...(excludedUserIds.length > 0 ? { creatorId: { notIn: excludedUserIds } } : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      };

      // Single Prisma query — Prisma resolves `members { user }` with a
      // batched sub-query (not per-row N+1) when `take` is set.
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
            where: { status: 'MEMBER' },
            take: 5,
            orderBy: { joinedAt: 'asc' },
            select: {
              userId: true,
              status: true,
              user: {
                select: { id: true, username: true, displayName: true, avatar: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (fetchedActivities.length > limit) {
        const next = fetchedActivities.pop()!;
        nextCursor = `${next.createdAt.toISOString()}|${next.id}`;
      }
      activities = fetchedActivities;

      // Cache base feed in background
      if (allowBaseCache && excludedUserIds.length === 0 && this.redis) {
        const resolvedBaseKey = `activities:feed:base:${scopeTag}:${limit}:${cursorDate ? cursorDate.toISOString() : 'none'}`;
        this.redis.setex(resolvedBaseKey, 60, JSON.stringify({ activities, nextCursor })).catch(() => {});
        this.registerFeedCacheKey(resolvedBaseKey);
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

    // ── Scoped membership query — PARALLEL with nothing (already separated) ───
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
        return { ...a, isJoined: myStatus === 'MEMBER', myStatus: myStatus || null };
      }),
      nextCursor,
    };

    // Cache user-specific response (includes isJoined flags)
    if (this.redis) {
      this.redis.setex(userCacheKey, 60, JSON.stringify(response)).catch(() => {});
      this.registerFeedCacheKey(userCacheKey);
    }
    const tLogic = performance.now() - logicStart;
    const totalMs = performance.now() - startTime;
    this.logger.log(
      `[STAGE_TIMINGS] GET /api/activities - Total: ${totalMs.toFixed(2)}ms | Redis: ${tCache.toFixed(2)}ms | PreFetch: ${tPreFetch.toFixed(2)}ms | BaseCache: ${baseFeed ? 'HIT' : 'MISS'} | MainDB: ${tMainDb.toFixed(2)}ms | MemberDB: ${tMemberDb.toFixed(2)}ms | Logic: ${tLogic.toFixed(2)}ms`
    );
    return response;
  }

  /** Column set for feed/preview cards — mirrors getAllActivities' select. */
  private static readonly CARD_SELECT = {
    id: true,
    creatorId: true,
    title: true,
    description: true,
    location: true,
    maxMembers: true,
    createdAt: true,
    coverImage: true,
    coverMediaId: true,
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
      where: { status: 'MEMBER' as const },
      take: 5,
      orderBy: { joinedAt: 'asc' as const },
      select: {
        userId: true,
        status: true,
        user: { select: { id: true, username: true, displayName: true, avatar: true } },
      },
    },
  } as const;

  /**
   * Composed payload for the Crew "For You" page: college + 1-on-1 previews in a
   * single cached round-trip. "Recent" is served by the paginated public feed and
   * intentionally NOT duplicated here. Each preview returns up to 3 rows so the
   * client can show 2 and decide whether to render a "See All".
   */
  async getCrewDiscover(userId: string) {
    const cacheKey = `activities:discover:${userId}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const [user, excludedUserIds] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeId: true, college: { select: { name: true } } },
      }),
      this.blocksService.getExcludedUserIds(userId),
    ]);

    const now = new Date();
    const creatorFilter = excludedUserIds.length > 0 ? { creatorId: { notIn: excludedUserIds } } : {};
    const collegeId = user?.collegeId ?? null;

    const [collegeRows, oneOnOneRows] = await Promise.all([
      collegeId
        ? this.prisma.crewActivity.findMany({
            where: {
              deletedAt: null,
              status: 'OPEN',
              startDate: { gt: now },
              visibility: 'COLLEGE_ONLY',
              collegeId,
              ...creatorFilter,
            },
            take: 3,
            orderBy: { createdAt: 'desc' },
            select: ActivitiesService.CARD_SELECT,
          })
        : Promise.resolve([]),
      this.prisma.crewActivity.findMany({
        where: {
          deletedAt: null,
          status: 'OPEN',
          startDate: { gt: now },
          visibility: 'PUBLIC',
          maxMembers: 2,
          ...creatorFilter,
        },
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: ActivitiesService.CARD_SELECT,
      }),
    ]);

    // One membership query over the (≤6) collected ids to attach join state.
    const ids = [...collegeRows, ...oneOnOneRows].map(a => a.id);
    const memberships = ids.length > 0
      ? await this.prisma.crewActivityMember.findMany({
          where: { userId, activityId: { in: ids } },
          select: { activityId: true, status: true },
        })
      : [];
    const membershipMap = new Map(memberships.map(m => [m.activityId, m.status]));
    const decorate = (a: any) => {
      const myStatus = membershipMap.get(a.id);
      return { ...a, isJoined: myStatus === 'MEMBER', myStatus: myStatus || null };
    };

    const result = {
      collegeName: user?.college?.name || null,
      collegeId,
      college: { items: collegeRows.slice(0, 2).map(decorate), hasMore: collegeRows.length > 2 },
      oneOnOne: { items: oneOnOneRows.slice(0, 2).map(decorate), hasMore: oneOnOneRows.length > 2 },
    };

    if (this.redis) {
      this.redis.setex(cacheKey, 60, JSON.stringify(result)).catch(() => {});
      this.registerFeedCacheKey(cacheKey);
    }
    return result;
  }

  async getActivityById(id: string, userId?: string) {
    const cleanId = id ? id.replace(/^(act_)+/, '') : id;
    const [activity, user, excludedUserIds] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: cleanId },
        include: {
          members: {
            include: { user: { select: { id: true, username: true, displayName: true, avatar: true, isCampusRep: true, collegeId: true, college: { select: { id: true, name: true } } } } }
          },
          invitations: { select: { inviteeId: true, status: true } },
          creator: { select: { id: true, username: true, displayName: true, avatar: true, isCampusRep: true, collegeId: true, college: { select: { id: true, name: true } } } },
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
      this.domainEventService.emit('activity.created', { id: createdActivity.id, creatorId, collegeId: user?.collegeId || null });
      this.clearActivityFeedCaches();
    });

    return createdActivity;
  }

  async joinActivity(activityId: string, userId: string): Promise<any> {
    // ── Single targeted read: only the fields we need from the activity + one membership row ──
    // No more `include: { members: true }` (which fetched ALL member rows).
    const [activityRow, user, existingMember] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: activityId },
        select: {
          id: true,
          creatorId: true,
          status: true,
          deletedAt: true,
          startDate: true,
          participationType: true,
          maxMembers: true,
          hostCollege: true,
          collegeId: true,
          visibility: true,
          invitations: { where: { inviteeId: userId }, select: { inviteeId: true, status: true } },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, collegeId: true },
      }),
      // Check membership in the same parallel round-trip
      this.prisma.crewActivityMember.findUnique({
        where: { userId_activityId: { userId, activityId } },
        select: { status: true },
      }),
    ]);

    if (!activityRow || activityRow.deletedAt) {
      throw new NotFoundException('Activity not found');
    }
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Idempotent: already a member → return success silently (no error)
    if (existingMember?.status === 'MEMBER') {
      return { success: true };
    }
    if (existingMember?.status === 'PENDING') {
      throw new BadRequestException('Join request already pending');
    }

    const startRaw = activityRow.startDate;
    if (startRaw && new Date(startRaw) <= new Date()) {
      throw new BadRequestException('Activity has already started and cannot be joined');
    }

    // Build a synthetic activity shape for the auth check (only the fields it reads)
    const authDecision = this.activityAuthorizationService.canJoin(
      user,
      { ...activityRow, members: [] } as any,
    );
    if (!authDecision.allowed) {
      throw new ForbiddenException(authDecision.reason || 'You are not authorized to join this activity');
    }

    // ── Atomic idempotent upsert — safe under concurrent requests ──────────────
    // If two requests race, the second one hits the unique constraint and the
    // ON CONFLICT DO NOTHING clause makes it a silent no-op instead of an error.
    await this.prisma.$executeRaw`
      INSERT INTO "CrewActivityMember" ("userId", "activityId", "status", "joinedAt")
      VALUES (${userId}, ${activityId}, 'MEMBER', NOW())
      ON CONFLICT ("userId", "activityId") DO UPDATE SET "status" = 'MEMBER'
    `;

    // Await cache clearing BEFORE responding to prevent the frontend's 
    // post-mutation refetch from racing and hitting stale Redis data.
    await this.clearActivityFeedCaches();
    if (this.redis) {
      await this.redis.del(`etag:/api/activities/${activityId}:${userId}`);
    }

    // Fire socket event side-effects in background
    setImmediate(() => {
      this.domainEventService.emit('activity.memberJoined', { activityId, userId });
    });

    return { success: true };
  }

  async leaveActivity(activityId: string, userId: string) {
    // ── Single targeted read (only fields needed for guard) ────────────────────
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: { creatorId: true },
    });

    if (activity?.creatorId === userId) {
      throw new BadRequestException('Host cannot leave their own activity');
    }

    // ── Idempotent delete — deleteMany never throws if the row is missing ──────
    await this.prisma.crewActivityMember.deleteMany({
      where: { userId, activityId },
    });

    // Await cache clearing BEFORE responding to prevent the frontend's 
    // post-mutation refetch from racing and hitting stale Redis data.
    await this.clearActivityFeedCaches();
    if (this.redis) {
      await this.redis.del(`etag:/api/activities/${activityId}:${userId}`);
    }

    // Fire socket event side-effects in background
    setImmediate(() => {
      this.domainEventService.emit('activity.memberLeft', { activityId, userId });
    });

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
      })
    ]);

    setImmediate(() => {
      this.domainEventService.emit('activity.updated', { id: activityId, status: 'CANCELLED' });
      this.clearActivityFeedCaches();
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
