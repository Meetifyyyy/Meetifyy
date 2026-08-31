import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import {
  ActivityAuthorizationService,
  UserAuthContext,
} from './activity-authorization.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { RedisService } from '../redis/redis.service';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import { ActivityVisibility } from '@prisma/client';

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
    @Optional()
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifQueue?: Queue,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
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
      this.expireStartedInvitations().catch(() => {});
      this.announceStartedActivities().catch(() => {});
    }, 60000);
  }

  /**
   * Settles invitations that were never answered before the activity STARTED.
   *
   * An invitation is an offer to come along, so it stops being answerable the
   * moment the thing begins — not when it finishes. `joinActivity` has always
   * refused a started activity, which meant an unanswered invite sat in the
   * Notifications page still offering Accept and Decline buttons that could
   * only ever fail. Expiring at the start time is what makes the record match
   * what the system will actually allow.
   *
   * Only PENDING rows are touched, so an accepted or declined invite keeps the
   * answer its recipient gave.
   */
  async expireStartedInvitations() {
    const now = new Date();
    try {
      const stale = await this.prisma.activityInvitation.findMany({
        where: {
          status: 'PENDING',
          activity: {
            deletedAt: null,
            startDate: { lte: now },
          },
        },
        select: { id: true, activityId: true, inviteeId: true },
      });
      if (stale.length === 0) return;

      await this.prisma.activityInvitation.updateMany({
        where: { id: { in: stale.map((i) => i.id) } },
        data: { status: 'EXPIRED' },
      });

      const byActivity = new Map<string, string[]>();
      for (const inv of stale) {
        const list = byActivity.get(inv.activityId) || [];
        list.push(inv.inviteeId);
        byActivity.set(inv.activityId, list);
      }
      for (const [activityId, inviteeIds] of byActivity) {
        await this.settleInviteNotifications(activityId, 'EXPIRED', inviteeIds);
        // Tells any open client to re-read; the notification row itself is
        // pushed directly to the recipient by settleInviteNotifications.
        await this.domainEventService.emit(
          'invitation:updated',
          { activityId, status: 'EXPIRED' },
          inviteeIds,
        );
      }
    } catch (err) {
      this.logger.error('Failed to expire started invitations', err);
    }
  }

  /** High-water mark for the start-time sweep; see announceStartedActivities. */
  private lastStartSweepAt: Date | null = null;

  /**
   * Announces activities that have just crossed their start time to whoever is
   * currently viewing them.
   *
   * "Started" is not a stored status — it is purely a function of `startDate`
   * and the current time — so nothing in the ordinary write path fires at the
   * moment it becomes true. Without this sweep the only client that learns of
   * the transition is one that happens to refetch.
   *
   * This is a best-effort nudge, NOT the guarantee: an open detail page also
   * runs its own timer to the authoritative start time, so the transition is
   * correct even if this process is not running, the socket is down, or the
   * sweep lands late. Deliberately room-scoped and detail-free.
   */
  async announceStartedActivities() {
    const now = new Date();
    const since = this.lastStartSweepAt;
    this.lastStartSweepAt = now;
    // First tick after boot has no window to compare against; skip rather than
    // replaying every activity that ever started.
    if (!since) return;

    try {
      const justStarted = await this.prisma.crewActivity.findMany({
        where: {
          status: 'OPEN',
          deletedAt: null,
          startDate: { gt: since, lte: now },
        },
        select: { id: true, startDate: true },
      });

      for (const act of justStarted) {
        await this.domainEventService.emit('activity.started', {
          activityId: act.id,
          id: act.id,
          startDate: act.startDate,
          serverNow: now.toISOString(),
        });
      }
    } catch (err) {
      this.logger.error('Failed to announce started activities', err);
    }
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
              startDate: { lte: new Date(now.getTime() - 3 * 60 * 60 * 1000) },
            },
          ],
        },
        select: { id: true },
      });

      if (expiredList && expiredList.length > 0) {
        const expiredIds = expiredList.map((a) => a.id);
        await this.prisma.crewActivity.updateMany({
          where: { id: { in: expiredIds } },
          data: { status: 'ENDED' },
        });

        // Read the outstanding invitees first: after the updateMany below there
        // is no longer any way to know whose invite went unanswered, and those
        // are exactly the notifications that must be moved to EXPIRED rather
        // than left showing live Accept/Decline buttons forever.
        const pendingInvites = await this.prisma.activityInvitation.findMany({
          where: { activityId: { in: expiredIds }, status: 'PENDING' },
          select: { activityId: true, inviteeId: true },
        });

        await this.prisma.activityInvitation.updateMany({
          where: { activityId: { in: expiredIds }, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });

        const inviteesByActivity = new Map<string, string[]>();
        for (const inv of pendingInvites) {
          const list = inviteesByActivity.get(inv.activityId) || [];
          list.push(inv.inviteeId);
          inviteesByActivity.set(inv.activityId, list);
        }
        for (const [actId, inviteeIds] of inviteesByActivity) {
          await this.settleInviteNotifications(actId, 'EXPIRED', inviteeIds);
        }

        for (const actId of expiredIds) {
          this.domainEventService.emit('activity.updated', {
            id: actId,
            status: 'ENDED',
          });
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
    if (
      !isNaN(parsed.getTime()) &&
      (cursor.includes('T') || cursor.includes('-') || !isNaN(Number(cursor)))
    ) {
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
        this.redis
          .setex(cacheKey, 3600, record.createdAt.toISOString())
          .catch(() => {});
      }
      return record.createdAt;
    }

    return undefined;
  }

  /**
   * Resolves the trusted viewer context (id + collegeId straight from the DB).
   * Never trust a college id supplied by the client.
   */
  private async getViewer(userId?: string): Promise<UserAuthContext | null> {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, collegeId: true },
    });
    return u ? { id: u.id, collegeId: u.collegeId } : null;
  }

  /**
   * Number of live invitations the viewer holds. Used only to decide whether a
   * feed page may be served from the college-shared cache: a user holding an
   * invitation can legitimately see activities their college-peers cannot, so
   * their page must never be written into (or read from) the shared entry.
   */
  private async countLiveInvitations(userId: string): Promise<number> {
    return this.prisma.activityInvitation.count({
      where: this.activityAuthorizationService.validInvitationWhere(userId),
    });
  }

  /**
   * Scoped feed. `scope` selects which slice of activities to return:
   *   - 'public'      → everything the viewer may discover (the "Recent" feed)
   *   - 'college'     → COLLEGE_ONLY activities belonging to the viewer's own
   *                     college. Deliberately NOT "everything hosted by my
   *                     college": a PUBLIC activity from the same college
   *                     belongs to the All section, and mixing it in here made
   *                     the College section misrepresent an activity's audience.
   *                     PRIVATE never appears — the discovery policy excludes it
   *                     structurally.
   *   - 'campus'      → the same COLLEGE_ONLY slice, surfaced on the Campus
   *                     page. It shares the college scope's rules exactly so the
   *                     two surfaces can never disagree about who may see what.
   *   - 'one_on_one'  → discoverable activities with exactly 2 slots
   *
   * Every scope is intersected with the central discovery policy at the DATABASE
   * layer, so a restricted activity is never fetched, never cached and therefore
   * cannot leak through a later page, a serializer or a stale client cache.
   */
  async getAllActivities(
    userId?: string,
    limit = 20,
    cursor?: string,
    scope: 'public' | 'college' | 'campus' | 'one_on_one' = 'public',
  ) {
    const startTime = performance.now();

    // ── Tier 1: user-specific cache ──────────────────────────────────────────
    // Keyed by the caller's own id, which is what determines their college and
    // their invitations — so this page is never reachable by anyone else, and
    // the fast path stays a single Redis round-trip with no DB work.
    const userCacheKey = `activities:feed:${scope}:${userId || 'anon'}:${limit}:${cursor || 'none'}`;
    let tCache = 0;

    if (this.redis) {
      const redisStart = performance.now();
      try {
        const userCached = await this.redis.get(userCacheKey);
        tCache = performance.now() - redisStart;
        if (userCached) {
          this.logger.log(
            `[STAGE_TIMINGS] GET /api/activities (USER_HIT) - Total: ${(performance.now() - startTime).toFixed(2)}ms | Redis: ${tCache.toFixed(2)}ms`,
          );
          return JSON.parse(userCached);
        }
      } catch {
        tCache = performance.now() - redisStart;
      }
    }

    // ── PreFetch: viewer + blocks + cursor + invitation count in parallel ─────
    const preFetchStart = performance.now();
    const [viewer, excludedUserIds, cursorDate, liveInvitationCount] =
      await Promise.all([
        // Trusted viewer identity/college — resolved server-side, never from the client.
        this.getViewer(userId),
        userId
          ? this.blocksService.getExcludedUserIds(userId)
          : Promise.resolve([]),
        this.resolveCursorDate(cursor),
        userId ? this.countLiveInvitations(userId) : Promise.resolve(0),
      ]);
    const tPreFetch = performance.now() - preFetchStart;

    // The college scope needs the caller's own college; a user with no college
    // has nothing to show there.
    const scopeCollegeId = viewer?.collegeId ?? null;
    const isCollegeScope = scope === 'college' || scope === 'campus';
    if (isCollegeScope && !scopeCollegeId) {
      return { activities: [], nextCursor: undefined };
    }

    // The audience tag pins every SHARED page to the college allowed to see it,
    // so a page built for one college can never be served to another.
    const audienceTag = `aud:${viewer?.collegeId || 'none'}`;
    const scopeTag = isCollegeScope ? `${scope}:${scopeCollegeId}` : scope;

    // A shared page is only sound for viewers with the same audience tag, no
    // blocks and no invitation-derived extra visibility.
    const allowBaseCache =
      excludedUserIds.length === 0 && liveInvitationCount === 0;
    const baseCacheKeyFor = (d?: Date) =>
      `activities:feed:base:${scopeTag}:${audienceTag}:${limit}:${d ? d.toISOString() : 'none'}`;

    // ── Tier 2: audience-scoped shared feed cache ────────────────────────────
    let baseFeed: { activities: any[]; nextCursor: string | undefined } | null =
      null;
    if (allowBaseCache && this.redis) {
      try {
        const cachedBase = await this.redis.get(baseCacheKeyFor(cursorDate));
        if (cachedBase) baseFeed = JSON.parse(cachedBase);
      } catch {}
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
      setImmediate(() => {
        this.autoExpireActivities().catch(() => {});
      });

      const now = new Date();
      const scopeFilter: any = {
        deletedAt: null,
        status: 'OPEN',
        startDate: { gt: now },
        // College and Campus are the COLLEGE_ONLY surfaces. Pinning the
        // visibility here (not just the college id) is what keeps "Anyone"
        // activities out of the College section, and it is applied in the
        // DATABASE query so the rule cannot be bypassed by a client that asks
        // for the scope directly.
        ...(isCollegeScope
          ? {
              collegeId: scopeCollegeId,
              visibility: ActivityVisibility.COLLEGE_ONLY,
            }
          : {}),
        ...(scope === 'one_on_one' ? { maxMembers: 2 } : {}),
        ...(excludedUserIds.length > 0
          ? { creatorId: { notIn: excludedUserIds } }
          : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      };

      // AND-composed with the policy filter so no other condition can widen it.
      //
      // A page that will be written to the SHARED cache is built from the
      // college-derived clauses only, so it stays correct for every viewer with
      // the same audience tag. Viewers whose visibility is personal (they hold a
      // live invitation, or they have blocks) get the full policy filter and a
      // page that is never shared.
      const policyWhere = allowBaseCache
        ? this.activityAuthorizationService.sharedAudienceWhere(viewer)
        : this.activityAuthorizationService.discoveryWhere(viewer);

      const whereClause: any = { AND: [scopeFilter, policyWhere] };

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
          coverColor: true,
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
          // Same reason as CARD_SELECT: the College/Campus surfaces label each
          // card with the college it belongs to.
          college: { select: { id: true, name: true } },
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
        const next = fetchedActivities.pop()!;
        nextCursor = `${next.createdAt.toISOString()}|${next.id}`;
      }
      activities = fetchedActivities;

      // Cache base feed in background
      if (allowBaseCache && this.redis) {
        const resolvedBaseKey = baseCacheKeyFor(cursorDate);
        this.redis
          .setex(
            resolvedBaseKey,
            60,
            JSON.stringify({ activities, nextCursor }),
          )
          .catch(() => {});
        this.registerFeedCacheKey(resolvedBaseKey);
      }
    }
    const tMainDb = performance.now() - dbStart;

    if (activities.length === 0) {
      const emptyRes = { activities: [], nextCursor: undefined };
      if (this.redis) {
        this.redis
          .setex(userCacheKey, 60, JSON.stringify(emptyRes))
          .catch(() => {});
        this.registerFeedCacheKey(userCacheKey);
      }
      const totalMs = performance.now() - startTime;
      this.logger.log(
        `[STAGE_TIMINGS] GET /api/activities (EMPTY) - Total: ${totalMs.toFixed(2)}ms | Redis: ${tCache.toFixed(2)}ms | PreFetch: ${tPreFetch.toFixed(2)}ms | MainDB: ${tMainDb.toFixed(2)}ms`,
      );
      return emptyRes;
    }

    // ── Scoped membership query — PARALLEL with nothing (already separated) ───
    const memberStart = performance.now();
    const activityIds = activities.map((a) => a.id);
    const joinedMemberships =
      userId && activityIds.length > 0
        ? await this.prisma.crewActivityMember.findMany({
            where: { userId, activityId: { in: activityIds } },
            select: { activityId: true, status: true },
          })
        : [];
    const tMemberDb = performance.now() - memberStart;

    const logicStart = performance.now();
    const membershipMap = new Map(
      joinedMemberships.map((m) => [m.activityId, m.status]),
    );

    const response = {
      activities: activities.map((a) => {
        const myStatus = membershipMap.get(a.id);
        return {
          ...a,
          isJoined: myStatus === 'MEMBER',
          myStatus: myStatus || null,
        };
      }),
      nextCursor,
    };

    // Cache user-specific response (includes isJoined flags)
    if (this.redis) {
      this.redis
        .setex(userCacheKey, 60, JSON.stringify(response))
        .catch(() => {});
      this.registerFeedCacheKey(userCacheKey);
    }
    const tLogic = performance.now() - logicStart;
    const totalMs = performance.now() - startTime;
    this.logger.log(
      `[STAGE_TIMINGS] GET /api/activities - Total: ${totalMs.toFixed(2)}ms | Redis: ${tCache.toFixed(2)}ms | PreFetch: ${tPreFetch.toFixed(2)}ms | BaseCache: ${baseFeed ? 'HIT' : 'MISS'} | MainDB: ${tMainDb.toFixed(2)}ms | MemberDB: ${tMemberDb.toFixed(2)}ms | Logic: ${tLogic.toFixed(2)}ms`,
    );
    return response;
  }

  /** Column set for feed/preview cards — mirrors getAllActivities' select. */
  private static readonly CARD_SELECT = {
    // `college` is selected (not just collegeId) so a card can render the
    // college tag the Campus page shows without a second lookup per row.
    college: { select: { id: true, name: true } },
    id: true,
    creatorId: true,
    title: true,
    description: true,
    location: true,
    maxMembers: true,
    createdAt: true,
    coverImage: true,
    coverColor: true,
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
        user: {
          select: { id: true, username: true, displayName: true, avatar: true },
        },
      },
    },
  } as const;

  /**
   * Composed payload for the Crew "For You" page: college + 1-on-1 previews in a
   * single cached round-trip. "Recent" is served by the paginated public feed and
   * intentionally NOT duplicated here. Each preview returns up to 3 rows so the
   * client can show 2 and decide whether to render a "See All".
   */
  // ── "For You" personalization ──────────────────────────────────────────────
  //
  // Same shape as the mention-suggestion ranker in UsersService: a bounded,
  // already-authorized candidate pool leaves the database, every signal is one
  // batched indexed query, and scoring happens in memory. Nothing here widens
  // access — the pool is produced by the discovery policy, and the page is
  // re-filtered through it again at hydration time.

  /** Upper bound on rows considered for a personalized ranking pass. */
  private static readonly FOR_YOU_POOL = 120;
  /** How long a user's ranked id list stays stable (also makes paging stable). */
  private static readonly FOR_YOU_RANK_TTL = 60;
  /** Recent conversations consulted for the "people you talk to" signal. */
  private static readonly FOR_YOU_RECENT_CONVERSATIONS = 15;
  /** Past memberships consulted for the "hosts you've joined before" signal. */
  private static readonly FOR_YOU_HISTORY_LIMIT = 50;

  /** Ranking weights, in one place so the ordering is readable and tunable. */
  private static readonly FOR_YOU_WEIGHTS = {
    hostIsMutual: 10000,
    hostIsFollow: 7000,
    hostRecentChat: 4000,
    friendAttending: 2500,
    friendAttendingCap: 3,
    hostJoinedBefore: 2000,
    sameCollege: 1500,
    interestMatch: 1200,
    interestMatchCap: 2,
    startsSoonMax: 800,
    startsSoonWindowDays: 14,
    hasRoom: 300,
  };

  /**
   * Ranks the activities this user may discover and returns the ordered ids.
   *
   * Ordering — not the rows — is what gets cached, which is what makes cursor
   * paging stable across pages while keeping the returned rows fresh.
   */
  private async getForYouRankedIds(userId: string): Promise<string[]> {
    const cacheKey = `activities:foryou:rank:${userId}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const now = new Date();
    const [
      viewer,
      excludedUserIds,
      followingRows,
      followerRows,
      recentConvs,
      historyRows,
    ] = await Promise.all([
      this.getViewer(userId),
      this.blocksService.getExcludedUserIds(userId),
      this.prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      }),
      this.prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
      }),
      this.prisma.conversationParticipant.findMany({
        where: { userId, deletedAt: null },
        select: { conversationId: true },
        orderBy: { conversation: { updatedAt: 'desc' } },
        take: ActivitiesService.FOR_YOU_RECENT_CONVERSATIONS,
      }),
      this.prisma.crewActivityMember.findMany({
        where: { userId, status: 'MEMBER' },
        select: { activityId: true },
        orderBy: { joinedAt: 'desc' },
        take: ActivitiesService.FOR_YOU_HISTORY_LIMIT,
      }),
    ]);

    const interests = viewer
      ? ((
          await this.prisma.user.findUnique({
            where: { id: userId },
            select: { interests: true },
          })
        )?.interests ?? [])
      : [];

    const candidates = await this.prisma.crewActivity.findMany({
      where: {
        AND: [
          {
            deletedAt: null,
            status: 'OPEN',
            startDate: { gt: now },
            ...(excludedUserIds.length > 0
              ? { creatorId: { notIn: excludedUserIds } }
              : {}),
          },
          this.activityAuthorizationService.discoveryWhere(viewer),
        ],
      },
      take: ActivitiesService.FOR_YOU_POOL,
      orderBy: { startDate: 'asc' },
      select: {
        id: true,
        creatorId: true,
        collegeId: true,
        title: true,
        description: true,
        location: true,
        startDate: true,
        maxMembers: true,
        _count: { select: { members: true } },
      },
    });

    if (candidates.length === 0) {
      if (this.redis) {
        this.redis
          .setex(cacheKey, ActivitiesService.FOR_YOU_RANK_TTL, '[]')
          .catch(() => {});
        this.registerFeedCacheKey(cacheKey);
      }
      return [];
    }

    const candidateIds = candidates.map((c) => c.id);
    const followingIds = followingRows.map((f) => f.followingId);
    const followingSet = new Set(followingIds);
    const followerSet = new Set(followerRows.map((f) => f.followerId));
    const convIds = recentConvs.map((c) => c.conversationId);
    const historyIds = historyRows.map((h) => h.activityId);

    // Remaining signals, all batched over the bounded candidate set.
    const [chatPartners, friendsAttending, pastHosts] = await Promise.all([
      convIds.length > 0
        ? this.prisma.conversationParticipant.findMany({
            where: { conversationId: { in: convIds }, userId: { not: userId } },
            select: { userId: true },
          })
        : Promise.resolve([] as { userId: string }[]),
      followingIds.length > 0
        ? this.prisma.crewActivityMember.findMany({
            where: {
              activityId: { in: candidateIds },
              userId: { in: followingIds },
              status: 'MEMBER',
            },
            select: { activityId: true, userId: true },
          })
        : Promise.resolve([] as { activityId: string; userId: string }[]),
      historyIds.length > 0
        ? this.prisma.crewActivity.findMany({
            where: { id: { in: historyIds } },
            select: { creatorId: true },
          })
        : Promise.resolve([] as { creatorId: string }[]),
    ]);

    const chatPartnerSet = new Set(chatPartners.map((p) => p.userId));
    const pastHostSet = new Set(pastHosts.map((h) => h.creatorId));
    const friendCountByActivity = new Map<string, number>();
    for (const row of friendsAttending) {
      friendCountByActivity.set(
        row.activityId,
        (friendCountByActivity.get(row.activityId) || 0) + 1,
      );
    }

    const normalizedInterests = interests
      .map((i) => (i || '').trim().toLowerCase())
      .filter((i) => i.length >= 3);

    const W = ActivitiesService.FOR_YOU_WEIGHTS;
    const soonWindowMs = W.startsSoonWindowDays * 24 * 60 * 60 * 1000;

    const scored = candidates.map((a) => {
      let score = 0;

      // Who is hosting matters most.
      const isFollowing = followingSet.has(a.creatorId);
      const isFollower = followerSet.has(a.creatorId);
      if (isFollowing && isFollower) score += W.hostIsMutual;
      else if (isFollowing || isFollower) score += W.hostIsFollow;

      if (chatPartnerSet.has(a.creatorId)) score += W.hostRecentChat;
      if (pastHostSet.has(a.creatorId)) score += W.hostJoinedBefore;

      // Then who else is already going.
      const friends = Math.min(
        friendCountByActivity.get(a.id) || 0,
        W.friendAttendingCap,
      );
      score += friends * W.friendAttending;

      if (
        viewer?.collegeId &&
        a.collegeId &&
        viewer.collegeId === a.collegeId
      ) {
        score += W.sameCollege;
      }

      if (normalizedInterests.length > 0) {
        const haystack =
          `${a.title || ''} ${a.description || ''} ${a.location || ''}`.toLowerCase();
        let matches = 0;
        for (const interest of normalizedInterests) {
          if (haystack.includes(interest)) matches += 1;
          if (matches >= W.interestMatchCap) break;
        }
        score += matches * W.interestMatch;
      }

      // A small freshness term so an empty signal profile still yields a sane,
      // soonest-first ordering rather than an arbitrary one.
      const msUntilStart = a.startDate
        ? new Date(a.startDate).getTime() - now.getTime()
        : soonWindowMs;
      const proximity = Math.max(
        0,
        1 - Math.max(msUntilStart, 0) / soonWindowMs,
      );
      score += Math.round(proximity * W.startsSoonMax);

      const memberCount = a._count?.members ?? 0;
      if (!a.maxMembers || memberCount < a.maxMembers) score += W.hasRoom;

      return {
        id: a.id,
        score,
        startAt: a.startDate
          ? new Date(a.startDate).getTime()
          : Number.MAX_SAFE_INTEGER,
      };
    });

    scored.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      if (x.startAt !== y.startAt) return x.startAt - y.startAt;
      return x.id.localeCompare(y.id);
    });

    const rankedIds = scored.map((s) => s.id);
    if (this.redis) {
      this.redis
        .setex(
          cacheKey,
          ActivitiesService.FOR_YOU_RANK_TTL,
          JSON.stringify(rankedIds),
        )
        .catch(() => {});
      this.registerFeedCacheKey(cacheKey);
    }
    return rankedIds;
  }

  /**
   * Hydrates ranked ids into full cards, preserving the ranked order.
   *
   * The hydration query re-applies the discovery policy and the "not started
   * yet" rule, so an id that was rankable a moment ago but has since been
   * restricted, cancelled or started simply drops out of the page.
   */
  private async hydrateRankedActivities(
    ids: string[],
    userId: string,
    viewer: UserAuthContext | null,
  ) {
    if (ids.length === 0) return [];

    // The ranking these ids come from is cached, so it can predate a block.
    // Re-reading the block set here — rather than trusting that the candidate
    // pool was filtered when it was built — is what stops a "For You" page
    // from serving an activity whose host has blocked this viewer since the
    // ranking was computed. Every other hydration rule is already re-applied
    // for exactly this reason; the block filter was the one that was not.
    const excludedUserIds = await this.blocksService.getExcludedUserIds(userId);

    const rows = await this.prisma.crewActivity.findMany({
      where: {
        AND: [
          {
            id: { in: ids },
            deletedAt: null,
            status: 'OPEN',
            startDate: { gt: new Date() },
            ...(excludedUserIds.length > 0
              ? { creatorId: { notIn: excludedUserIds } }
              : {}),
          },
          this.activityAuthorizationService.discoveryWhere(viewer),
        ],
      },
      select: ActivitiesService.CARD_SELECT,
    });

    const memberships = await this.prisma.crewActivityMember.findMany({
      where: { userId, activityId: { in: rows.map((r) => r.id) } },
      select: { activityId: true, status: true },
    });
    const membershipMap = new Map(
      memberships.map((m) => [m.activityId, m.status]),
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((a: any) => {
        const myStatus = membershipMap.get(a.id);
        return {
          ...a,
          isJoined: myStatus === 'MEMBER',
          myStatus: myStatus || null,
        };
      });
  }

  /**
   * The personalized "For You" feed, paginated over the cached ranking.
   *
   * The cursor is an offset into that ranking rather than a timestamp: the order
   * is by relevance, not recency, so a date cursor could not express a position
   * in it.
   */
  async getForYouFeed(userId: string, limit = 20, cursor?: string) {
    const parsedOffset = cursor?.startsWith('off:')
      ? parseInt(cursor.slice(4), 10)
      : 0;
    const offset =
      Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    const [rankedIds, viewer] = await Promise.all([
      this.getForYouRankedIds(userId),
      this.getViewer(userId),
    ]);

    const pageIds = rankedIds.slice(offset, offset + limit);
    const activities = await this.hydrateRankedActivities(
      pageIds,
      userId,
      viewer,
    );
    const nextOffset = offset + limit;

    return {
      activities,
      nextCursor:
        nextOffset < rankedIds.length ? `off:${nextOffset}` : undefined,
    };
  }

  /** Cards shown per subsection on the "All" tab before "See all". */
  private static readonly PREVIEW_SIZE = 5;

  /**
   * Composed payload for the Crew "All" tab: the three subsections — For You,
   * From Your College, and 1-on-1 — in a single cached round-trip.
   *
   * Each subsection returns up to PREVIEW_SIZE items plus a `hasMore` flag for
   * its "See all" affordance. Sections are de-duplicated in render order (For
   * You first), so one activity never appears twice on the page; `hasMore`
   * accounts for that, since an activity removed as a duplicate is still
   * reachable from the section's own full list.
   */
  async getCrewDiscover(userId: string) {
    const cacheKey = `activities:discover:${userId}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const PREVIEW = ActivitiesService.PREVIEW_SIZE;
    const [user, excludedUserIds, rankedIds] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          collegeId: true,
          college: { select: { name: true } },
        },
      }),
      this.blocksService.getExcludedUserIds(userId),
      this.getForYouRankedIds(userId),
    ]);

    const viewer: UserAuthContext | null = user
      ? { id: user.id, collegeId: user.collegeId }
      : null;
    const now = new Date();
    const creatorFilter =
      excludedUserIds.length > 0
        ? { creatorId: { notIn: excludedUserIds } }
        : {};
    const collegeId = user?.collegeId ?? null;

    // Every section is intersected with the same discovery policy, so PUBLIC
    // ("Anyone") activities are eligible everywhere while COLLEGE_ONLY ones only
    // reach same-college or invited viewers and PRIVATE ones reach no one.
    const policyWhere =
      this.activityAuthorizationService.discoveryWhere(viewer);
    const baseFilter = {
      deletedAt: null,
      status: 'OPEN' as const,
      startDate: { gt: now },
      ...creatorFilter,
    };

    // Over-fetch by one so each section can report `hasMore` without a count.
    const [forYouRows, collegeRows, oneOnOneRows] = await Promise.all([
      this.hydrateRankedActivities(
        rankedIds.slice(0, PREVIEW + 1),
        userId,
        viewer,
      ),
      collegeId
        ? this.prisma.crewActivity.findMany({
            // COLLEGE_ONLY only — same rule as the `college` feed scope behind
            // this section's "See all", so the preview and the full list agree.
            // A PUBLIC activity from the same college belongs to For You / All.
            where: {
              AND: [
                {
                  ...baseFilter,
                  collegeId,
                  visibility: ActivityVisibility.COLLEGE_ONLY,
                },
                policyWhere,
              ],
            },
            take: PREVIEW + 1,
            // Same ordering as the full list behind "See all", so the preview
            // reads as the top of that list rather than a different one.
            orderBy: { createdAt: 'desc' },
            select: ActivitiesService.CARD_SELECT,
          })
        : Promise.resolve([]),
      this.prisma.crewActivity.findMany({
        where: { AND: [{ ...baseFilter, maxMembers: 2 }, policyWhere] },
        take: PREVIEW + 1,
        orderBy: { createdAt: 'desc' },
        select: ActivitiesService.CARD_SELECT,
      }),
    ]);

    // One membership query over the collected ids to attach join state.
    const ids = [...collegeRows, ...oneOnOneRows].map((a) => a.id);
    const memberships =
      ids.length > 0
        ? await this.prisma.crewActivityMember.findMany({
            where: { userId, activityId: { in: ids } },
            select: { activityId: true, status: true },
          })
        : [];
    const membershipMap = new Map(
      memberships.map((m) => [m.activityId, m.status]),
    );
    const decorate = (a: any) => {
      const myStatus = membershipMap.get(a.id);
      return {
        ...a,
        isJoined: myStatus === 'MEMBER',
        myStatus: myStatus || null,
      };
    };

    // Sections are filled in render order and each one skips what is already on
    // screen above it.
    const shown = new Set<string>();
    const section = (rows: any[], alreadyDecorated = false) => {
      const fresh = rows.filter((a) => !shown.has(a.id));
      const items = fresh.slice(0, PREVIEW);
      items.forEach((a) => shown.add(a.id));
      return {
        items: items.map((a) => (alreadyDecorated ? a : decorate(a))),
        hasMore: rows.length > PREVIEW,
      };
    };

    const result = {
      collegeName: user?.college?.name || null,
      collegeId,
      // `hasMore` comes from the ranking itself, not the hydrated slice: a row
      // can drop out during hydration (started, cancelled, restricted) while the
      // ranked list still holds plenty more.
      forYou: {
        ...section(forYouRows, true),
        hasMore: rankedIds.length > PREVIEW,
      },
      college: section(collegeRows),
      oneOnOne: section(oneOnOneRows),
    };

    if (this.redis) {
      this.redis.setex(cacheKey, 60, JSON.stringify(result)).catch(() => {});
      this.registerFeedCacheKey(cacheKey);
    }
    return result;
  }

  /**
   * Activity details for the direct link / detail page.
   *
   * The row is loaded, judged by the central policy and only then serialized —
   * an unauthorized caller receives a 403 carrying a code and generic copy, and
   * never the title, description, location, host or attendee list.
   */
  /** Attendees embedded in the detail payload; the rest load incrementally. */
  private static readonly DETAIL_MEMBER_PAGE = 30;

  async getActivityById(id: string, userId?: string) {
    const cleanId = id ? id.replace(/^(act_)+/, '') : id;
    const [activity, user, excludedUserIds, myMembership] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: cleanId },
        include: {
          // Bounded: an activity can hold hundreds of attendees, and shipping
          // every row (with a joined user each) made the detail payload grow
          // without limit. The first page renders the avatar stack immediately;
          // `memberCount` below stays authoritative for the count, and the full
          // list is paged in from the attendees endpoint.
          members: {
            take: ActivitiesService.DETAIL_MEMBER_PAGE,
            orderBy: { joinedAt: 'asc' },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatar: true,
                  isCampusRep: true,
                  collegeId: true,
                  college: { select: { id: true, name: true } },
                },
              },
            },
          },
          _count: { select: { members: true } },
          // Only the caller's own invitation row is loaded: the full invitee list
          // is host-only information (see getInvitationStatuses).
          invitations: userId
            ? {
                where: { inviteeId: userId },
                select: {
                  inviteeId: true,
                  status: true,
                  revokedAt: true,
                  expiresAt: true,
                },
              }
            : {
                where: { inviteeId: '' },
                select: {
                  inviteeId: true,
                  status: true,
                  revokedAt: true,
                  expiresAt: true,
                },
              },
          creator: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
              isCampusRep: true,
              collegeId: true,
              college: { select: { id: true, name: true } },
            },
          },
        },
      }),
      userId
        ? this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, collegeId: true },
          })
        : Promise.resolve(null),
      userId
        ? this.blocksService.getExcludedUserIds(userId)
        : Promise.resolve([]),
      // The caller's own membership, resolved by primary key in the same
      // parallel round-trip. It must NOT be read off the `members` slice above:
      // that slice is capped, so a member beyond the cap would otherwise fail
      // the policy's membership test and be denied their own activity.
      userId
        ? this.prisma.crewActivityMember.findUnique({
            where: { userId_activityId: { userId, activityId: cleanId } },
            select: { userId: true, status: true },
          })
        : Promise.resolve(null),
    ]);

    // Blocking the host must not make an event the viewer already joined
    // unusable. An attendee keeps access to the essentials — when, where, what —
    // and only the host's identity is withheld; a non-attendee still gets the
    // neutral 404 that every other blocked surface returns.
    const hostBlocked =
      !!activity &&
      excludedUserIds.length > 0 &&
      excludedUserIds.includes(activity.creatorId);

    if (!activity || activity.deletedAt || (hostBlocked && !myMembership)) {
      throw new NotFoundException('Activity not found');
    }

    // Authorization target carries the caller's own membership row explicitly,
    // independent of how many attendees the payload happens to embed.
    const authTarget = {
      ...(activity as any),
      members: myMembership ? [myMembership] : [],
    };

    // Authorization boundary — throws 403 with a detail-free body.
    this.activityAuthorizationService.assertCanView(user, authTarget);

    const joinDecision = user
      ? this.activityAuthorizationService.canJoin(user, {
          ...authTarget,
          _count: { members: (activity as any)._count?.members ?? 0 },
        })
      : {
          allowed: false,
          reason: 'Login required',
          code: 'AUTH_REQUIRED' as const,
        };
    // The embedded first page of attendees is filtered per-viewer, exactly like
    // getAttendees. The host is exempt: they must see every participant even
    // when two of their guests have blocked each other.
    //
    // memberCount below is intentionally left as the raw _count, so the total
    // stays accurate even though this viewer sees fewer rows.
    // Captured before filtering: "is there another page?" is a property of the
    // underlying query, not of how many rows survive this viewer's block list.
    const loadedMemberPageSize = (activity as any).members?.length ?? 0;

    if (
      userId &&
      activity.creatorId !== userId &&
      (activity as any).members?.length
    ) {
      const visibleIds = new Set(
        await this.blocksService.filterBlockedUsers(
          userId,
          (activity as any).members.map((m: any) => m.userId).filter(Boolean),
        ),
      );
      (activity as any).members = (activity as any).members.filter((m: any) =>
        visibleIds.has(m.userId),
      );
    }

    const { invitations, _count, ...activityFields } = activity as any;
    return {
      ...activityFields,
      // The server's clock, so a client can measure its own offset and time the
      // "already started" transition against the authoritative start instant
      // rather than against a device clock that may be minutes out.
      serverNow: new Date().toISOString(),
      // Host identity is suppressed rather than the whole event: the profile
      // stays unreachable (no name, no avatar, nothing to tap through to)
      // while date, time, location and description survive.
      ...(hostBlocked
        ? { creator: null, creatorId: null, hostUnavailable: true }
        : {}),
      // Authoritative attendee total — `members` is only the first page.
      memberCount: _count?.members ?? loadedMemberPageSize,
      hasMoreMembers:
        loadedMemberPageSize >= ActivitiesService.DETAIL_MEMBER_PAGE,
      isJoined: myMembership?.status === 'MEMBER',
      myStatus: myMembership?.status || null,
      isInvited: this.activityAuthorizationService.hasValidInvitation(
        user,
        activity,
      ),
      canJoin: joinDecision.allowed,
      joinRestrictionReason: joinDecision.reason || null,
      joinRestrictionCode: joinDecision.code || 'ALLOWED',
    };
  }

  /**
   * Cursor-paginated attendees.
   *
   * The detail payload embeds only the first page (see DETAIL_MEMBER_PAGE); this
   * serves the rest, so an activity with hundreds of attendees costs the same to
   * open as one with three. Access is resolved through the same policy as the
   * detail endpoint — an attendee list is restricted data.
   */
  async getAttendees(
    activityId: string,
    userId: string,
    limit = 30,
    cursor?: string,
  ) {
    const take = Math.min(Math.max(limit, 1), 60);
    const cleanId = activityId
      ? activityId.replace(/^(act_)+/, '')
      : activityId;

    const [activity, user, myMembership] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: cleanId },
        select: {
          id: true,
          creatorId: true,
          collegeId: true,
          visibility: true,
          status: true,
          deletedAt: true,
          invitations: {
            where: { inviteeId: userId },
            select: {
              inviteeId: true,
              status: true,
              revokedAt: true,
              expiresAt: true,
            },
          },
        },
      }),
      this.getViewer(userId),
      this.prisma.crewActivityMember.findUnique({
        where: { userId_activityId: { userId, activityId: cleanId } },
        select: { userId: true, status: true },
      }),
    ]);

    if (!activity || activity.deletedAt)
      throw new NotFoundException('Activity not found');
    this.activityAuthorizationService.assertCanView(user, {
      ...(activity as any),
      members: myMembership ? [myMembership] : [],
    });

    // Cursor is `joinedAt|userId` — joinedAt alone is not unique.
    let cursorFilter: any = {};
    if (cursor) {
      const [joinedAtRaw, cursorUserId] = cursor.split('|');
      const joinedAt = new Date(joinedAtRaw);
      if (!isNaN(joinedAt.getTime()) && cursorUserId) {
        cursorFilter = {
          OR: [
            { joinedAt: { gt: joinedAt } },
            { joinedAt, userId: { gt: cursorUserId } },
          ],
        };
      }
    }

    // Attendees the viewer is blocked with are excluded — but never for the
    // host, who must keep a complete guest list to run the event. Filtering in
    // the query (not after) keeps the keyset page size honest.
    const isHost = activity.creatorId === userId;
    const attendeeWhere = isHost
      ? { activityId: cleanId, status: 'MEMBER' as const, ...cursorFilter }
      : await this.blocksService.injectBlockFilter(
          userId,
          { activityId: cleanId, status: 'MEMBER' as const, ...cursorFilter },
          'userId',
        );

    const rows = await this.prisma.crewActivityMember.findMany({
      where: attendeeWhere,
      orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
      take: take + 1,
      select: {
        userId: true,
        status: true,
        joinedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            isCampusRep: true,
            collegeId: true,
            college: { select: { id: true, name: true } },
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page[page.length - 1];

    return {
      attendees: page,
      nextCursor:
        hasMore && last
          ? `${last.joinedAt.toISOString()}|${last.userId}`
          : null,
      hasMore,
    };
  }

  async createActivity(data: any, creatorId: string) {
    if (
      !data.title ||
      typeof data.title !== 'string' ||
      data.title.trim().length === 0
    ) {
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
      // An activity may not be created for a slot that has already begun. The
      // client disables Publish once the start lapses, but a stale tab, a
      // replayed request or a non-browser client can still submit one — and a
      // past-dated activity is immediately "ENDED" and unjoinable.
      // The grace window absorbs clock skew between client and server.
      const CLOCK_SKEW_GRACE_MS = 2 * 60 * 1000;
      if (start.getTime() < Date.now() - CLOCK_SKEW_GRACE_MS) {
        throw new BadRequestException('Start date must be in the future');
      }
      const maxDurationMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (end.getTime() - start.getTime() > maxDurationMs) {
        throw new BadRequestException(
          'Activity duration cannot exceed 30 days',
        );
      }
    }

    let visibility: 'PUBLIC' | 'COLLEGE_ONLY' | 'PRIVATE' = 'PUBLIC';
    if (
      data.visibility === 'COLLEGE_ONLY' ||
      data.visibility === 'PRIVATE' ||
      data.visibility === 'PUBLIC'
    ) {
      visibility = data.visibility;
    } else if (data.whoCanJoin === 'College' || data.shareToCampus) {
      visibility = 'COLLEGE_ONLY';
    } else if (data.whoCanJoin === 'Private' || data.whoCanJoin === 'No one') {
      // 'No one' is the retired label for the same mode; still accepted so an
      // older client build cannot silently create a PUBLIC activity instead.
      visibility = 'PRIVATE';
    }

    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { collegeId: true },
    });

    // A COLLEGE_ONLY activity whose host has no college can never satisfy its own
    // restriction — it would be silently unreachable for everyone but the host.
    // Reject it rather than publish something invisible.
    if (visibility === 'COLLEGE_ONLY' && !user?.collegeId) {
      throw new BadRequestException(
        'Add your college to your profile before creating a college-only activity',
      );
    }

    const createData: any = {
      creatorId,
      title: data.title,
      description: data.description,
      // Cover is either an image or a solid colour, never both. Normalising here
      // keeps the mutually-exclusive invariant in one place instead of trusting
      // the client to send a consistent trio.
      ...(data.coverColor
        ? { coverColor: data.coverColor, coverImage: null, coverMediaId: null }
        : {
            coverColor: null,
            coverImage: data.coverImage ?? null,
            coverMediaId: data.coverMediaId ?? null,
          }),
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      location: data.location,
      maxMembers: data.maxMembers ? parseInt(data.maxMembers, 10) : null,
      visibility,
      // `shareToCampus` is a presentation flag derived from visibility, never an
      // independent restriction: a PUBLIC ("Anyone") activity must stay
      // college-agnostic even if a client sends shareToCampus: true.
      shareToCampus: visibility === 'COLLEGE_ONLY',
      collegeId: user?.collegeId || null,
      members: {
        create: [{ userId: creatorId, status: 'MEMBER' }],
      },
    };

    let createdActivity: any;
    try {
      createdActivity = await this.prisma.crewActivity.create({
        data: createData,
        select: {
          id: true,
          creatorId: true,
          title: true,
          description: true,
          coverImage: true,
          coverColor: true,
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
      });
    } catch (err) {
      if (data.coverImage) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(data.coverImage, creatorId)
          .catch(() => {});
      }
      throw err;
    }

    setImmediate(() => {
      this.domainEventService.emit('activity.created', {
        id: createdActivity.id,
        creatorId,
        collegeId: user?.collegeId || null,
      });
      this.clearActivityFeedCaches();
    });

    return createdActivity;
  }

  /**
   * Host-only visibility change. Authorization is re-derived from the stored
   * visibility on every subsequent request, so the switch takes effect
   * immediately: this method only has to make sure nothing STALE survives it —
   * cached feed pages, cached detail ETags and live realtime subscriptions are
   * all invalidated before it returns.
   *
   *   Anyone  → College : other-college viewers lose access unless invited.
   *   College → Private : discovery stops; invitation becomes the only way in.
   *   Private → Anyone  : becomes organically discoverable again.
   */
  async updateActivityVisibility(
    activityId: string,
    hostId: string,
    visibility: string,
  ) {
    const allowed = ['PUBLIC', 'COLLEGE_ONLY', 'PRIVATE'] as const;
    if (!allowed.includes(visibility as any)) {
      throw new BadRequestException(
        'visibility must be one of PUBLIC, COLLEGE_ONLY, PRIVATE',
      );
    }
    const next = visibility as 'PUBLIC' | 'COLLEGE_ONLY' | 'PRIVATE';

    const [activity, host] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: activityId },
        select: {
          id: true,
          creatorId: true,
          deletedAt: true,
          visibility: true,
          collegeId: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: hostId },
        select: { id: true, collegeId: true },
      }),
    ]);

    if (!activity || activity.deletedAt) {
      throw new NotFoundException('Activity not found');
    }
    // 404 rather than 403: a non-host must not learn the id exists.
    this.activityAuthorizationService.assertCanManage(
      { id: hostId },
      activity as any,
    );

    if (next === 'COLLEGE_ONLY' && !activity.collegeId && !host?.collegeId) {
      throw new BadRequestException(
        'Add your college to your profile before restricting this activity to your college',
      );
    }

    const updated = await this.prisma.crewActivity.update({
      where: { id: activityId },
      data: {
        visibility: next,
        shareToCampus: next === 'COLLEGE_ONLY',
        // A college-restricted activity must always carry the host's college,
        // otherwise the restriction could never be satisfied by anyone.
        ...(next === 'COLLEGE_ONLY' && !activity.collegeId
          ? { collegeId: host?.collegeId ?? null }
          : {}),
      },
      select: {
        id: true,
        visibility: true,
        shareToCampus: true,
        collegeId: true,
      },
    });

    // Purge every cached surface BEFORE returning so the client's post-mutation
    // refetch cannot observe the pre-change authorization.
    await this.clearActivityFeedCaches();

    // Evicts newly-unauthorized sockets from the activity's realtime room.
    await this.domainEventService.emit('activity.visibilityChanged', {
      activityId,
      id: activityId,
      visibility: updated.visibility,
    });

    return { success: true, ...updated };
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
          invitations: {
            where: { inviteeId: userId },
            select: {
              inviteeId: true,
              status: true,
              revokedAt: true,
              expiresAt: true,
            },
          },
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
    // There is no approval queue any more — joining is direct, governed only by
    // the activity's visibility rules. A legacy PENDING row is simply promoted
    // to MEMBER by the ON CONFLICT upsert below.

    const startRaw = activityRow.startDate;
    if (startRaw && new Date(startRaw) <= new Date()) {
      throw new BadRequestException(
        'Activity has already started and cannot be joined',
      );
    }

    // Build a synthetic activity shape for the auth check (only the fields it reads)
    const authDecision = this.activityAuthorizationService.canJoin(user, {
      ...activityRow,
      members: [],
    });
    if (!authDecision.allowed) {
      // Same disclosure rule as assertCanView: a private activity a caller may
      // not see must answer "not found" here too, or the join endpoint becomes
      // an oracle for the existence of activities the detail endpoint hides.
      if (
        authDecision.code === 'PRIVATE' ||
        authDecision.code === 'NOT_FOUND'
      ) {
        throw new NotFoundException('Activity not found');
      }
      throw new ForbiddenException(
        authDecision.reason || 'You are not authorized to join this activity',
      );
    }

    // ── Atomic idempotent upsert with capacity enforcement — safe under concurrent requests ──
    // If two requests race when capacity is nearly full, the atomic CTE evaluates
    // the current member count directly in Postgres, preventing over-subscription (TOCTOU).
    //
    // `xmax = 0` is the standard Postgres test for "this row was genuinely
    // INSERTed rather than updated by the conflict path". It's what makes the
    // host notification below exactly-once at the database level: two concurrent
    // joins that both pass the membership pre-check still yield only one `true`,
    // so only one notification is created.
    const upsertResult = await this.prisma.$queryRaw<
      Array<{ inserted: boolean }>
    >`
      WITH current_count AS (
        SELECT COUNT(*)::int AS cnt
        FROM "CrewActivityMember"
        WHERE "activityId" = ${activityId} AND "status" = 'MEMBER'
      ),
      act AS (
        SELECT "maxMembers"
        FROM "CrewActivity"
        WHERE "id" = ${activityId} AND "deletedAt" IS NULL
      )
      INSERT INTO "CrewActivityMember" ("userId", "activityId", "status", "joinedAt")
      SELECT ${userId}, ${activityId}, 'MEMBER', NOW()
      FROM act, current_count
      WHERE (
        act."maxMembers" IS NULL
        OR current_count.cnt < act."maxMembers"
        OR EXISTS (
          SELECT 1 FROM "CrewActivityMember"
          WHERE "userId" = ${userId} AND "activityId" = ${activityId} AND "status" = 'MEMBER'
        )
      )
      ON CONFLICT ("userId", "activityId") DO UPDATE SET "status" = 'MEMBER'
      RETURNING (xmax = 0) AS inserted
    `;

    if (!upsertResult || upsertResult.length === 0) {
      throw new ForbiddenException('Activity is full');
    }

    const isNewMember = upsertResult?.[0]?.inserted === true;

    // Await cache clearing BEFORE responding to prevent the frontend's
    // post-mutation refetch from racing and hitting stale Redis data.
    await this.clearActivityFeedCaches();

    // Fire socket event side-effects in background
    setImmediate(() => {
      this.domainEventService.emit('activity.memberJoined', {
        activityId,
        userId,
      });
    });

    // ── Host notification ─────────────────────────────────────────────────────
    // Only on a real membership transition (isNewMember), and never to yourself.
    // Dispatched off the response path so a slow notification write can't delay
    // the join returning.
    if (
      isNewMember &&
      activityRow.creatorId &&
      activityRow.creatorId !== userId
    ) {
      setImmediate(() => {
        this.notifyHostOfJoin(activityId, userId, activityRow.creatorId).catch(
          (err) => {
            this.logger.warn(
              `Failed to notify host of activity join: ${err?.message}`,
            );
          },
        );
      });
    }

    return { success: true };
  }

  /**
   * "<User> joined your activity" — uses the shared NotificationFactory payload
   * so it renders and routes exactly like every other activity notification.
   */
  private async notifyHostOfJoin(
    activityId: string,
    userId: string,
    creatorId: string,
  ) {
    const [actor, activity] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, username: true, avatar: true },
      }),
      this.prisma.crewActivity.findUnique({
        where: { id: activityId },
        select: { id: true, title: true, coverImage: true, coverColor: true },
      }),
    ]);
    if (!actor || !activity) return;

    // Respects the recipient's blocklist, notification preferences and
    // real-time delivery, same as every other notification path.
    await this.notificationsService.createNotification(
      this.notificationFactory.createActivityJoin(actor, activity, creatorId),
    );
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

    // Fire socket event side-effects in background
    setImmediate(() => {
      this.domainEventService.emit('activity.memberLeft', {
        activityId,
        userId,
      });
    });

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
      data: { status: 'DECLINED' },
    });
    this.domainEventService.emit('activity.updated', { id: activityId });
    return { success: true };
  }

  async cancelCrewActivity(activityId: string, currentUserId: string) {
    return this.closeCrewActivity(activityId, currentUserId, 'CANCELLED');
  }

  async endCrewActivity(activityId: string, currentUserId: string) {
    return this.closeCrewActivity(activityId, currentUserId, 'ENDED');
  }

  /**
   * Closes an activity, either because the host cancelled it or because it is
   * over. The two are NOT the same outcome for someone holding an unanswered
   * invite — "the host called it off" and "it already happened" are different
   * facts — so the terminal status is carried all the way through to the
   * invitation row and to the invite notification the recipient still holds.
   *
   * Outstanding invites are settled here rather than silently dropped: the
   * notification is re-stated in place (CANCELLED / EXPIRED), never deleted,
   * and only for invitees who never answered — an accepted or declined invite
   * keeps the record of what that person actually did.
   */
  private async closeCrewActivity(
    activityId: string,
    currentUserId: string,
    terminalStatus: 'CANCELLED' | 'ENDED',
  ) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId, creatorId: currentUserId },
      select: { id: true },
    });
    if (!activity)
      throw new NotFoundException('Activity not found or you are not creator');

    // Captured BEFORE the update — once the rows move off PENDING there is no
    // way to tell who had an outstanding invite.
    const pendingInvitees = await this.prisma.activityInvitation.findMany({
      where: { activityId, status: 'PENDING' },
      select: { inviteeId: true },
    });

    const invitationStatus =
      terminalStatus === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED';

    await Promise.all([
      this.prisma.crewActivity.update({
        where: { id: activityId },
        data: { status: terminalStatus },
      }),
      this.prisma.activityInvitation.updateMany({
        where: { activityId, status: 'PENDING' },
        data: { status: invitationStatus },
      }),
    ]);

    await this.settleInviteNotifications(
      activityId,
      invitationStatus,
      pendingInvitees.map((i) => i.inviteeId),
    );

    setImmediate(() => {
      this.domainEventService.emit('activity.updated', {
        id: activityId,
        status: terminalStatus,
      });
      this.clearActivityFeedCaches();
    });

    return { success: true };
  }

  /**
   * Re-states an invite notification in place. Never creates one and never
   * removes one; `onlyIfStatusIn: ['PENDING']` is what stops a cancellation
   * from rewriting the row of someone who had already accepted or declined.
   *
   * Every settle — the recipient's own answer as well as the activity reaching
   * a terminal state — goes through here so all of them log a failure rather
   * than swallowing it. A silently dropped update here is what leaves a row
   * showing Accept/Decline for an invite that was already answered.
   */
  private async settleInviteNotifications(
    activityId: string,
    status: 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED',
    recipientIds: string[],
  ) {
    if (recipientIds.length === 0) return;
    await this.notificationsService
      .updateNotificationLifecycleStatus({
        type: 'ACTIVITY_INVITE' as any,
        entityId: activityId,
        recipientIds,
        status,
        onlyIfStatusIn: ['PENDING'],
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to settle invite notifications for ${activityId}`,
          err,
        ),
      );
  }

  async bookmarkActivity(activityId: string, userId: string) {
    const [activity, user] = await Promise.all([
      this.prisma.crewActivity.findUnique({
        where: { id: activityId, deletedAt: null },
        include: {
          members: {
            where: { userId },
            select: { userId: true, status: true },
          },
          invitations: {
            where: { inviteeId: userId },
            select: {
              inviteeId: true,
              status: true,
              revokedAt: true,
              expiresAt: true,
            },
          },
        },
      }),
      this.getViewer(userId),
    ]);
    if (!activity) throw new NotFoundException('Activity not found');
    // Saving is a read-granting action: bookmarks are re-served later by
    // getSavedActivities, so it must not become a back door.
    this.activityAuthorizationService.assertCanView(user, activity);

    await this.prisma.activityBookmark.upsert({
      where: { userId_activityId: { userId, activityId } },
      create: { userId, activityId },
      update: {},
    });

    return { success: true, isBookmarked: true, activityId };
  }

  async unbookmarkActivity(activityId: string, userId: string) {
    const existing = await this.prisma.activityBookmark.findUnique({
      where: { userId_activityId: { userId, activityId } },
    });
    if (existing) {
      await this.prisma.activityBookmark.delete({
        where: { userId_activityId: { userId, activityId } },
      });
    }
    return { success: true, isBookmarked: false, activityId };
  }

  async getSavedActivityIds(userId: string) {
    const bookmarks = await this.prisma.activityBookmark.findMany({
      where: { userId },
      select: { activityId: true },
      orderBy: { createdAt: 'desc' },
    });
    return bookmarks.map((b) => b.activityId);
  }

  /**
   * The user's own activities — hosted or joined — for the Ongoing / Upcoming /
   * Past split.
   *
   * One query, not two: this used to fetch every membership row, marshal the
   * ids into the client, and send them back as an `IN (...)` list that grew with
   * the user's history. The membership test is now a relation filter resolved in
   * SQL, and the embedded member preview is capped and restricted to actual
   * members (it previously included PENDING and DECLINED rows in the avatars).
   */
  async getMyActivities(userId: string) {
    // A host who blocks someone should not keep appearing in their list. The
    // viewer's own activities are exempt by construction (you cannot block
    // yourself), and an activity they merely joined drops out — the same
    // outcome the detail route gives a non-attendee.
    const excludedUserIds = await this.blocksService.getExcludedUserIds(userId);

    const activities = await this.prisma.crewActivity.findMany({
      where: {
        deletedAt: null,
        ...(excludedUserIds.length > 0
          ? { creatorId: { notIn: excludedUserIds } }
          : {}),
        OR: [
          { creatorId: userId },
          { members: { some: { userId, status: 'MEMBER' } } },
        ],
      },
      include: {
        _count: { select: { members: true } },
        members: {
          where: { status: 'MEMBER' },
          take: 5,
          orderBy: { joinedAt: 'asc' },
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
      // Ordered by when the activity HAPPENS, not when its row was written.
      // `createdAt` put two activities drafted in the same sitting next to each
      // other regardless of whether one was tomorrow and the other next month,
      // which is what left the Past list in no discernible order. Most recent
      // first is the right end for past events; the client still splits
      // past/ongoing/upcoming and orders each bucket for its own direction.
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    return activities.map((a) => ({
      ...a,
      isJoined: true,
      myStatus: 'MEMBER',
    }));
  }

  /**
   * Bookmarked activities. A bookmark is a stale pointer: the activity may have
   * been switched to COLLEGE_ONLY or PRIVATE after it was saved, so the list is
   * re-filtered through the access policy at the query layer rather than trusted.
   */
  async getSavedActivities(userId: string, limit = 20, cursor?: string) {
    const [excludedUserIds, viewer] = await Promise.all([
      this.blocksService.getExcludedUserIds(userId),
      this.getViewer(userId),
    ]);

    let cursorDate: Date | undefined;
    if (cursor) {
      const cursorBookmark = await this.prisma.activityBookmark.findFirst({
        where: { userId, activityId: cursor },
        select: { createdAt: true },
      });
      if (cursorBookmark) cursorDate = cursorBookmark.createdAt;
    }

    const bookmarks = await this.prisma.activityBookmark.findMany({
      where: {
        userId,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        activity: {
          AND: [
            { deletedAt: null, creatorId: { notIn: excludedUserIds } },
            this.activityAuthorizationService.accessWhere(viewer),
          ],
        },
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
                    avatar: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    let nextCursor: string | null = null;
    if (bookmarks.length > limit) {
      const nextItem = bookmarks.pop();
      nextCursor = nextItem?.activityId || null;
    }

    const rawActs = bookmarks.map((b) => b.activity).filter(Boolean);

    const myMemberships = await this.prisma.crewActivityMember.findMany({
      where: { userId, activityId: { in: rawActs.map((a) => a.id) } },
    });
    const membershipMap = new Map(
      myMemberships.map((m) => [m.activityId, m.status]),
    );

    const formattedActivities = rawActs.map((act) => {
      const members = act.members || [];
      const hostMember = members.find((m) => m.user?.id === act.creatorId);
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
        coverColor: act.coverColor,
        participationType: act.participationType,
        shareToCampus: act.shareToCampus,
        collegeId: act.collegeId,
        hostCollege: act.hostCollege,
        hostName: hostUser?.displayName || hostUser?.username || 'Host',
        hostAvatar: hostUser?.avatar,
        hostUsername: hostUser?.username,
        slotsNeeded: act.maxMembers || 0,
        slotsFilled: act._count?.members || members.length,
        participants: members.map((m) => m.user?.id).filter(Boolean),
        _membersData: members.map((m) => m.user).filter(Boolean),
        isJoined,
        isPending,
        isBookmarked: true,
      };
    });

    return {
      activities: formattedActivities,
      nextCursor,
    };
  }

  async inviteFriends(
    activityId: string,
    inviterId: string,
    inviteeIds: string[],
  ) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        creatorId: true,
        status: true,
        deletedAt: true,
        visibility: true,
        collegeId: true,
        title: true,
        location: true,
        coverImage: true,
        coverColor: true,
        startDate: true,
        endDate: true,
        members: { select: { userId: true } },
      },
    });

    if (!activity || activity.deletedAt) {
      throw new NotFoundException('Activity not found');
    }

    this.activityAuthorizationService.assertCanManage(
      { id: inviterId },
      activity as any,
    );

    if (activity.status !== 'OPEN') {
      throw new BadRequestException('Activity is not open for invitations');
    }

    // A started activity is still OPEN until the expiry sweep closes it, but an
    // invitation to it can no longer be accepted — joinActivity refuses a
    // started activity. Sending one would put a notification in front of the
    // invitee that is expired the moment it arrives.
    if (activity.startDate && new Date(activity.startDate) <= new Date()) {
      throw new BadRequestException('This activity has already started');
    }

    const cleanInviteeIds = Array.from(
      new Set((inviteeIds || []).filter((id) => id && id !== inviterId)),
    );
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

    const existingMembers = new Set(activity.members.map((m) => m.userId));
    const invitationMap = new Map(
      existingInvitations.map((inv) => [inv.inviteeId, inv]),
    );
    const excludedSet = new Set(excludedUserIds);
    const results: any[] = [];
    const inviteesToProcess: string[] = [];
    const fourHoursMs = 4 * 60 * 60 * 1000;

    for (const inviteeId of cleanInviteeIds) {
      if (existingMembers.has(inviteeId)) {
        results.push({
          inviteeId,
          status: 'MEMBER',
          message: 'User is already a participant',
        });
        continue;
      }

      const existingInv = invitationMap.get(inviteeId);
      if (existingInv) {
        // Already said yes. Normally they are also in `existingMembers` and
        // were caught above, but the invitation is the record of the answer and
        // it must block a re-invite on its own — otherwise someone who accepted
        // and later left could be sent a fresh invite, which would reset their
        // answered notification back to Pending.
        if (existingInv.status === 'ACCEPTED') {
          results.push({
            inviteeId,
            status: 'ACCEPTED',
            message: 'User has already accepted this invitation',
          });
          continue;
        }

        if (existingInv.status === 'PENDING') {
          results.push({
            inviteeId,
            status: 'PENDING',
            message: 'Invitation Pending',
          });
          continue;
        }

        if (existingInv.status === 'DECLINED' && existingInv.respondedAt) {
          const timeSinceDecline =
            Date.now() - new Date(existingInv.respondedAt).getTime();
          if (timeSinceDecline < fourHoursMs) {
            const remainingMins = Math.ceil(
              (fourHoursMs - timeSinceDecline) / 60000,
            );
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
        results.push({
          inviteeId,
          status: 'BLOCKED',
          message: 'Cannot invite user',
        });
        continue;
      }

      inviteesToProcess.push(inviteeId);
    }

    if (inviteesToProcess.length > 0) {
      await this.prisma.activityInvitation.createMany({
        data: inviteesToProcess.map((inviteeId) => ({
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
        results.push({
          inviteeId: inv.inviteeId,
          status: 'INVITED',
          invitationId: inv.id,
        });
      }

      const notificationPayload = {
        activityId: activity.id,
        inviterId,
        invitations: createdInvitations.map((i) => ({
          inviteeId: i.inviteeId,
          invitationId: i.id,
        })),
        activityTitle: activity.title,
        activityLocation: activity.location,
        activityCoverImage: activity.coverImage,
        activityCoverColor: activity.coverColor,
        startDate: activity.startDate,
        endDate: activity.endDate,
        inviter: {
          id: inviter?.id || inviterId,
          name: inviter?.displayName || inviter?.username || 'Host',
          username: inviter?.username || '',
          avatar: inviter?.avatar,
        },
      };

      // The invite NOTIFICATION is the durable record of the invite and of what
      // the recipient eventually did with it. The queue is injected with
      // @Optional(), so on any deployment without a worker this was silently
      // never written: the invite existed only as an ActivityInvitation row,
      // which is pending-only, and answering it therefore made the row vanish
      // from the Notifications page instead of turning into "Accepted".
      //
      // The queue stays the preferred path (retries, off the request path); the
      // inline call is the fallback when there is no queue or the enqueue
      // fails. Both run the same method, and createNotification upserts, so a
      // late-arriving job cannot produce a duplicate.
      const dispatchInline = () =>
        this.notificationsService
          .createActivityInviteNotifications(notificationPayload)
          .catch((err) =>
            this.logger.error('Failed to create invite notifications', err),
          );

      if (this.notifQueue) {
        // `await` inside try/catch rather than `.catch()` on the return value:
        // a queue client can throw synchronously or hand back something that is
        // not a promise, and this runs detached in a setImmediate where either
        // would surface as an unhandled crash instead of a failed enqueue.
        setImmediate(async () => {
          try {
            await this.notifQueue?.add(
              'activity-invitations',
              notificationPayload,
              {
                removeOnComplete: true,
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
              },
            );
          } catch (err) {
            this.logger.warn(
              'Failed to enqueue activity invitations job to BullMQ',
              err,
            );
            await dispatchInline();
          }
        });
      } else {
        setImmediate(dispatchInline);
      }
    }

    return { results };
  }

  async getPendingInvitations(userId: string) {
    const invitations = await this.prisma.activityInvitation.findMany({
      where: {
        // Same validity rules the access policy applies, so the list can never
        // advertise an invitation that would be rejected on accept.
        ...this.activityAuthorizationService.validInvitationWhere(userId),
        status: 'PENDING',
        activity: {
          deletedAt: null,
          // An invitation to something that has already begun is not
          // answerable — the sweep will mark it EXPIRED, and until it does
          // this filter keeps it out of the actionable list. Without it the
          // list could offer an Accept that the join endpoint would refuse.
          OR: [{ startDate: null }, { startDate: { gt: new Date() } }],
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

    return invitations.map((inv) => ({
      id: inv.id,
      activityId: inv.activityId,
      title: inv.activity.title,
      description: inv.activity.description,
      location: inv.activity.location,
      coverImage: inv.activity.coverImage,
      coverColor: inv.activity.coverColor,
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
      sampleParticipants: inv.activity.members
        .map((m) => m.user)
        .filter(Boolean),
    }));
  }

  /**
   * Accept an invitation: validate → JOIN → record the answer.
   *
   * The join happens BEFORE the invitation is marked ACCEPTED and before this
   * method returns, so the caller can navigate straight to the activity and
   * find themselves already a participant — there is no second "I'm in" step,
   * and no window in which the invite reads as accepted while the membership
   * row does not exist yet. If the join is refused (full, started, cancelled,
   * visibility withdrawn) the invitation stays PENDING and the error surfaces,
   * so a failed acceptance never redirects anywhere.
   *
   * IDEMPOTENT by design. A double-click, a retry after a dropped response, or
   * two tabs racing all converge on the same single membership row: the
   * membership write is an ON CONFLICT upsert inside joinActivity, and an
   * already-ACCEPTED invitation is re-confirmed here rather than rejected.
   * Only a genuinely unusable invitation (not yours, revoked, expired,
   * declined, cancelled) is a 404.
   */
  async acceptInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.activityInvitation.findUnique({
      where: { id: invitationId },
      include: { activity: true },
    });

    // Bound to the AUTHENTICATED user — the invitation id alone grants nothing.
    // `isValidInvitation` admits PENDING and ACCEPTED and rejects revoked or
    // expired rows, which is exactly the set that may be (re-)accepted.
    if (
      !invitation ||
      invitation.inviteeId !== userId ||
      !this.activityAuthorizationService.isValidInvitation(invitation, userId)
    ) {
      throw new NotFoundException('Invitation not found or no longer pending');
    }

    // A retry of an invitation that was already accepted must not fail: if the
    // membership exists the work is done, so report the same success the first
    // call did and let the caller navigate.
    if (invitation.status === 'ACCEPTED') {
      const existingMember = await this.prisma.crewActivityMember.findUnique({
        where: {
          userId_activityId: { userId, activityId: invitation.activityId },
        },
        select: { status: true },
      });
      if (existingMember?.status === 'MEMBER') {
        // Settle the notification here too. This path is taken by every retry
        // and every double-click, so if the FIRST accept failed to advance the
        // notification the row would otherwise be stuck offering Accept and
        // Decline forever — no later attempt would ever reach the update below.
        await this.settleInviteNotifications(
          invitation.activityId,
          'ACCEPTED',
          [userId],
        );
        return {
          success: true,
          activityId: invitation.activityId,
          alreadyJoined: true,
        };
      }
      // ACCEPTED without a membership row means the previous attempt died
      // between the two writes. Fall through and complete the join.
    }

    // Answerable only while the activity has not begun. joinActivity refuses a
    // started activity anyway, but failing here first means the invite is also
    // SETTLED as expired rather than left PENDING for a button that can never
    // succeed.
    await this.assertInvitationStillAnswerable(invitation, userId);

    // joinActivity re-runs the full policy independently; accepting an
    // invitation is never a bypass of capacity/status/visibility rules. It is
    // itself idempotent (ON CONFLICT upsert), so concurrent accepts cannot
    // create duplicate participant rows.
    await this.joinActivity(invitation.activityId, userId);

    // Conditional write: a cancellation or expiry that landed while the join
    // was in flight has already moved this row off PENDING, and it must win —
    // otherwise the invitation would read ACCEPTED for an activity that no
    // longer exists to be accepted.
    await this.prisma.activityInvitation.updateMany({
      where: { id: invitationId, status: { in: ['PENDING', 'ACCEPTED'] } },
      data: {
        status: 'ACCEPTED',
        respondedAt: invitation.respondedAt ?? new Date(),
      },
    });

    // The invite notification is kept and re-stated, never removed — the
    // recipient should still be able to see that they were invited and that
    // they accepted. Only a PENDING row is advanced, so a duplicate accept
    // cannot rewrite an already-settled record.
    await this.settleInviteNotifications(invitation.activityId, 'ACCEPTED', [
      userId,
    ]);

    this.domainEventService.emit(
      'invitation:updated',
      {
        invitationId,
        status: 'ACCEPTED',
        activityId: invitation.activityId,
      },
      [invitation.inviterId, userId],
    );

    return { success: true, activityId: invitation.activityId };
  }

  async declineInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.activityInvitation.findUnique({
      where: { id: invitationId },
    });

    if (
      !invitation ||
      invitation.inviteeId !== userId ||
      invitation.status !== 'PENDING'
    ) {
      throw new NotFoundException('Invitation not found or no longer pending');
    }

    await this.assertInvitationStillAnswerable(invitation, userId);

    // Same conditional write as accept: only a still-PENDING invitation can be
    // declined, so a concurrent cancellation is not overwritten.
    const declined = await this.prisma.activityInvitation.updateMany({
      where: { id: invitationId, status: 'PENDING' },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
      },
    });
    if (declined.count === 0) {
      throw new NotFoundException('Invitation not found or no longer pending');
    }

    await this.settleInviteNotifications(invitation.activityId, 'DECLINED', [
      userId,
    ]);

    this.domainEventService.emit(
      'invitation:updated',
      {
        invitationId,
        status: 'DECLINED',
        activityId: invitation.activityId,
      },
      [invitation.inviterId, userId],
    );

    return { success: true };
  }

  /**
   * Host revokes an outstanding invitation. Revocation is immediate and total:
   * `revokedAt` makes the row fail {@link ActivityAuthorizationService.isValidInvitation},
   * so the invitee loses view/join/discovery access on the very next request and
   * is evicted from the activity's realtime room.
   *
   * Revoking does NOT remove an already-joined member — use the member flow for
   * that; it only withdraws the standing permission.
   */
  /**
   * Refuses an answer to an invitation whose activity has already started, and
   * settles the record on the way out so the recipient's Notifications page
   * stops offering a choice that no longer exists.
   *
   * Accept and decline share this because they must agree: a user must not be
   * able to decline something they can no longer accept, or the two buttons
   * would report different truths about the same invite.
   */
  private async assertInvitationStillAnswerable(
    invitation: { id: string; activityId: string },
    userId: string,
  ) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: invitation.activityId },
      select: { startDate: true, deletedAt: true },
    });

    if (!activity || activity.deletedAt) {
      throw new NotFoundException('Activity not found');
    }
    if (!activity.startDate || new Date(activity.startDate) > new Date())
      return;

    await this.prisma.activityInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    await this.settleInviteNotifications(invitation.activityId, 'EXPIRED', [
      userId,
    ]);
    await this.domainEventService.emit(
      'invitation:updated',
      {
        invitationId: invitation.id,
        activityId: invitation.activityId,
        status: 'EXPIRED',
      },
      [userId],
    );

    throw new BadRequestException('This activity has already started');
  }

  async revokeInvitation(
    activityId: string,
    hostId: string,
    inviteeId: string,
  ) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        creatorId: true,
        deletedAt: true,
        visibility: true,
        collegeId: true,
      },
    });
    if (!activity || activity.deletedAt) {
      throw new NotFoundException('Activity not found');
    }
    this.activityAuthorizationService.assertCanManage(
      { id: hostId },
      activity as any,
    );

    const result = await this.prisma.activityInvitation.updateMany({
      where: { activityId, inviteeId, revokedAt: null },
      data: { revokedAt: new Date(), status: 'CANCELLED' },
    });

    if (result.count > 0) {
      await this.settleInviteNotifications(activityId, 'CANCELLED', [
        inviteeId,
      ]);
      await this.clearActivityFeedCaches();
      await this.domainEventService.emit('activity.visibilityChanged', {
        activityId,
        id: activityId,
        reason: 'INVITATION_REVOKED',
      });
    }

    return { success: true, revoked: result.count };
  }

  /**
   * Who has been invited / is on cooldown. The full invitee list is host-only
   * information — a participant or a stranger must not be able to enumerate it.
   */
  async getInvitationStatuses(activityId: string, hostId: string) {
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        creatorId: true,
        visibility: true,
        status: true,
        collegeId: true,
        members: { select: { userId: true } },
        invitations: {
          select: { inviteeId: true, status: true, respondedAt: true },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    this.activityAuthorizationService.assertCanManage(
      { id: hostId },
      activity as any,
    );

    const memberSet = new Set(activity.members.map((m) => m.userId));
    const fourHoursMs = 4 * 60 * 60 * 1000;

    const statuses: Record<string, { status: string; remainingMins?: number }> =
      {};

    for (const m of activity.members) {
      statuses[m.userId] = { status: 'MEMBER' };
    }

    for (const inv of activity.invitations) {
      if (memberSet.has(inv.inviteeId)) {
        statuses[inv.inviteeId] = { status: 'MEMBER' };
        continue;
      }

      if (inv.status === 'ACCEPTED') {
        // They accepted; the invite picker must show them as already in rather
        // than offering to invite them again. Reported as MEMBER because that
        // is what accepting means, and the picker already renders that state.
        statuses[inv.inviteeId] = { status: 'MEMBER' };
      } else if (inv.status === 'PENDING') {
        statuses[inv.inviteeId] = { status: 'PENDING' };
      } else if (inv.status === 'DECLINED' && inv.respondedAt) {
        const timeSinceDecline =
          Date.now() - new Date(inv.respondedAt).getTime();
        if (timeSinceDecline < fourHoursMs) {
          const remainingMins = Math.ceil(
            (fourHoursMs - timeSinceDecline) / 60000,
          );
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
