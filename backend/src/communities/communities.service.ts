import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { PresenceService } from '../presence/presence.service';
import { BlocksService } from '../users/blocks.service';
import { DefaultAssetsService } from '../uploads/default-assets.service';
import { sampleRandom } from '../common/utils/sample-random.util';
import Redis from 'ioredis';
import {
  roleCan,
  moderatorPermissions,
  type CommunityRoleName,
} from './moderator-permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { MediaCleanupService } from '../uploads/media-cleanup.service';

@Injectable()
export class CommunitiesService implements OnModuleInit {
  private readonly logger = new Logger('CommunitiesService');
  private redis: Redis | null = null;
  // In-process fallback used only when Redis is unavailable
  private readonly localFallback = new Map<
    string,
    { data: any[]; timestamp: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventService: DomainEventService,
    private readonly redisService: RedisService,
    private readonly presenceService: PresenceService,
    private readonly defaultAssets: DefaultAssetsService,
    private readonly blocksService: BlocksService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
  ) {
    this.redis = this.redisService.getClient();
  }

  async onModuleInit() {
    try {
      await this.prisma
        .$executeRawUnsafe(
          `ALTER TYPE "CommunityRole" ADD VALUE IF NOT EXISTS 'OWNER'`,
        )
        .catch(() => {});
      await this.prisma
        .$executeRawUnsafe(
          `ALTER TYPE "CommunityRole" ADD VALUE IF NOT EXISTS 'MODERATOR'`,
        )
        .catch(() => {});
      // One set-based statement, where this used to read every community into
      // the process and issue one `upsert` per row, sequentially, on every
      // boot. That is O(communities) round trips before the instance is
      // ready — the repair is idempotent and almost always a no-op, so the
      // cost was paid in full on each deploy for nothing.
      //
      // The `WHERE` on the conflict branch matters as much as the batching:
      // without it Postgres rewrites every owner row on every boot, producing
      // a dead tuple per community per restart for rows that already said
      // OWNER. Now only genuinely wrong rows are touched, so a healthy
      // database does zero writes here.
      const repaired = await this.prisma.$executeRawUnsafe(`
        INSERT INTO "CommunityMember" ("userId", "communityId", "role", "joinedAt")
        SELECT c."ownerId", c.id, 'OWNER'::"CommunityRole", NOW()
          FROM "Community" c
         WHERE c."ownerId" IS NOT NULL
           AND c."deletedAt" IS NULL
        ON CONFLICT ("userId", "communityId") DO UPDATE
           SET "role" = 'OWNER'::"CommunityRole"
         WHERE "CommunityMember"."role" <> 'OWNER'::"CommunityRole"
      `);
      this.logger.log(`Repaired owner roles for ${repaired} communities.`);
      // Only worth dropping the caches if something actually changed. A clean
      // boot no longer starts every instance with a cold community cache.
      if (repaired > 0) await this.invalidateCommunityCache();
    } catch (e: any) {
      if (e?.message?.includes('Cannot use a pool after calling end')) return;
      this.logger.error('Failed to auto-repair community owner roles', e);
    }
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  /**
   * How many members the community detail loads for the member strip.
   *
   * One constant for the query's `take` and for the "is this strip a complete
   * membership or a window onto a larger one?" test below — if those two ever
   * disagreed, a member just past the boundary would silently be reported as
   * a non-member.
   */
  private static readonly MEMBER_STRIP_LIMIT = 50;

  /** Tag-Set name that tracks all live community list cache keys in Redis. */
  private static readonly LIST_TAG = 'communities:tag:lists';

  /** Register a key into the tag-Set so invalidation can find it without SCAN. */
  private registerListCacheKey(redisKey: string): void {
    if (!this.redis) return;
    this.redis.sadd(CommunitiesService.LIST_TAG, redisKey).catch(() => {});
    this.redis.expire(CommunitiesService.LIST_TAG, 300).catch(() => {}); // 5-min safety TTL
  }

  private async getCachedList(key: string): Promise<any[] | null> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(`communities:${key}`);
        if (raw) return JSON.parse(raw);
      } catch {
        /* fallthrough to local */
      }
    }
    const local = this.localFallback.get(key);
    if (local) {
      if (Date.now() - local.timestamp < 60_000) return local.data;
      this.localFallback.delete(key);
    }
    return null;
  }

  private async setCachedList(
    key: string,
    data: any[],
    ttlSeconds = 60,
  ): Promise<void> {
    const redisKey = `communities:${key}`;
    if (this.redis) {
      try {
        await this.redis.set(redisKey, JSON.stringify(data), 'EX', ttlSeconds);
        this.registerListCacheKey(redisKey);
        return;
      } catch {
        /* fallthrough to local */
      }
    }
    this.localFallback.set(key, { data, timestamp: Date.now() });
  }

  /** Cache a single community detail object. */
  private async getCachedCommunity(id: string): Promise<any | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(`community:${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async setCachedCommunity(
    id: string,
    data: any,
    ttlSeconds = 60,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      const redisKey = `community:${id}`;
      await this.redis.set(redisKey, JSON.stringify(data), 'EX', ttlSeconds);
      // Deliberately NOT registered in the list tag-Set. A detail key is
      // addressable by its own id, so the writes that change one community can
      // delete exactly that key. Registering it here put every community's
      // detail entry into the set that invalidation empties wholesale, so one
      // person joining one community evicted the cached page of every other
      // community on the platform — on a busy instance the detail cache could
      // never survive long enough to serve a second reader.
    } catch {
      /* ignore */
    }
  }

  /** Backing store for the in-process collegeId cache (see below). */
  private static readonly collegeIdCache = new Map<
    string,
    { collegeId: string; expiresAt: number }
  >();
  private static readonly COLLEGE_ID_TTL_MS = 10 * 60 * 1000;
  private static readonly COLLEGE_ID_CACHE_MAX = 10_000;

  /**
   * Cache a user's collegeId so getCampusCommunities does not need a DB
   * round-trip on every request. TTL: 10 minutes (college affiliation rarely changes).
   *
   * PERF: this cache is in-process, not in Redis. A Redis round-trip from the
   * app server measures ~67ms while the single-column lookup it replaces costs
   * ~33ms, so the Redis version was slower than the query on a hit and cost
   * ~167ms (GET + query + SET) on a miss. Nothing ever invalidated the Redis
   * key either — it was pure TTL — so an in-process map has identical staleness
   * semantics at ~0ms.
   */
  private async getCachedCollegeId(userId: string): Promise<string | null> {
    const hit = CommunitiesService.collegeIdCache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.collegeId;
    if (hit) CommunitiesService.collegeIdCache.delete(userId);
    return null;
  }

  private async setCachedCollegeId(
    userId: string,
    collegeId: string,
  ): Promise<void> {
    const cache = CommunitiesService.collegeIdCache;
    if (cache.size >= CommunitiesService.COLLEGE_ID_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
      if (cache.size >= CommunitiesService.COLLEGE_ID_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    cache.set(userId, {
      collegeId,
      expiresAt: Date.now() + CommunitiesService.COLLEGE_ID_TTL_MS,
    });
  }

  /**
   * A user's collegeId, from the in-process cache or the database.
   *
   * The same six lines were written out three times — in getCampusCommunities,
   * in getCommunityById and in joinCommunity — and only two of the three wrote
   * the value back into the cache, so the join path re-queried it every time.
   */
  private async resolveCollegeId(userId: string): Promise<string | null> {
    if (!userId) return null;
    const cached = await this.getCachedCollegeId(userId);
    if (cached) return cached;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { collegeId: true },
    });
    if (!user?.collegeId) return null;
    await this.setCachedCollegeId(userId, user.collegeId);
    return user.collegeId;
  }

  /**
   * Whether a membership row has an unacknowledged moderator welcome notice,
   * and the notice itself.
   *
   * One definition, used by both the dedicated endpoint and the copy carried
   * on the community payload, so the two can never disagree about whether a
   * notice is still pending.
   */
  private pendingModeratorNotice(
    member: {
      role: string;
      moderatorPromotedAt: Date | null;
      moderatorNoticeAckedAt: Date | null;
    } | null,
  ) {
    if (!member || member.role !== 'MODERATOR' || !member.moderatorPromotedAt) {
      return null;
    }
    const acked = member.moderatorNoticeAckedAt;
    if (acked && acked >= member.moderatorPromotedAt) return null;
    return {
      promotedAt: member.moderatorPromotedAt,
      permissions: moderatorPermissions(),
    };
  }

  /**
   * Targeted cache invalidation using tag-Set pattern.
   * Previously used hardcoded page-size keys which missed non-standard limit/offset values.
   * Now: fetches only the keys that were actually written via setCachedList/setCachedCommunity
   * and deletes them atomically. No SCAN of the entire keyspace.
   *
   * @param communityId  Specific community detail key to invalidate.
   * @param collegeId    Unused — campus list keys are all registered in the tag-Set.
   */
  private async invalidateCommunityCache(
    communityId?: string,
    collegeId?: string,
  ): Promise<void> {
    if (this.redis) {
      try {
        // The list keys, which every write can invalidate: member counts drive
        // the ordering of every list, so a join anywhere reorders all of them.
        const toDelete = await this.redis.smembers(CommunitiesService.LIST_TAG);

        // The detail key for the one community that actually changed. Other
        // communities' cached detail bodies are left alone — nothing in this
        // write can have altered them.
        if (communityId) toDelete.push(`community:${communityId}`);

        if (toDelete.length > 0) {
          await this.redis.del(...toDelete);
        }
        // Clean the tag-Set itself so it is re-seeded cleanly
        await this.redis.del(CommunitiesService.LIST_TAG);
      } catch {
        /* ignore */
      }
    }
    // Targeted local fallback deletion instead of clear-all
    if (communityId) {
      this.localFallback.delete(`detail:${communityId}`);
    }
    this.localFallback.delete('all:30:0');
    this.localFallback.delete('all:20:0');
    this.localFallback.delete('all:50:0');
    if (collegeId) {
      this.localFallback.delete(`campus:${collegeId}:30:0`);
      this.localFallback.delete(`campus:${collegeId}:20:0`);
    }
  }

  async getAllCommunities(userId?: string, limit = 30, offset = 0) {
    const cacheKey = `all:${limit}:${offset}`;
    let communities = await this.getCachedList(cacheKey);
    if (!communities) {
      communities = await this.prisma.community.findMany({
        where: { deletedAt: null, isCampusCommunity: false },
        // Projected to what the browse grid, the sidebar's joined list and the
        // post/comment community tags actually read. The unprojected findMany
        // this replaces also returned `deletedAt` (null for every row it can
        // return, by construction), `collegeId`, `updatedAt` and the two media
        // foreign keys — none of which any consumer reads, on a payload that
        // is cached, mirrored into IndexedDB on the client, and fetched on
        // every app boot.
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          avatarKey: true,
          coverKey: true,
          color: true,
          memberCount: true,
          ownerId: true,
          isPrivate: true,
          isCampusCommunity: true,
          createdAt: true,
        },
        orderBy: { memberCount: 'desc' },
        take: limit,
        skip: offset,
      });
      await this.setCachedList(cacheKey, communities, 60);
    }

    if (!userId || communities.length === 0) {
      return communities.map((c) => ({
        ...c,
        isJoined: false,
        userRole: null,
      }));
    }

    const userMemberships = await this.prisma.communityMember.findMany({
      where: { userId, communityId: { in: communities.map((c) => c.id) } },
      select: { communityId: true, role: true },
    });

    const membershipMap = new Map(
      userMemberships.map((m) => [m.communityId, m.role]),
    );

    return communities.map((c) => {
      const isOwner = Boolean(c.ownerId && c.ownerId === userId);
      const isMember = membershipMap.has(c.id);
      return {
        ...c,
        isJoined: isMember || isOwner,
        userRole: isOwner ? 'OWNER' : membershipMap.get(c.id) || null,
      };
    });
  }

  /**
   * "Discover Communities" — the profile sidebar's suggestion panel.
   *
   * It used to slice the top three of `GET /communities` by member count on
   * the client, which meant every viewer saw the same three biggest
   * communities forever, joined ones included until the list happened to
   * refetch. Two problems in one: no variety, and the panel could be entirely
   * made of communities the viewer was already in.
   *
   * Both are fixed the same way "Who to follow" was. Communities the viewer
   * has already joined are excluded in SQL, the most popular of the rest form
   * a pool, and `limit` are drawn at random from it — so a reload produces a
   * different valid selection without ever suggesting somewhere they already
   * are.
   *
   * Membership is tested through `members: { none: … }` alone. That covers
   * ownership too: creating a community writes the creator a `CommunityMember`
   * row with role OWNER, so an owner is always a member. (Verified against the
   * database: no non-deleted community has an owner without a member row.)
   * Testing `ownerId` as well would need care rather than being free — Prisma
   * compiles a negated equality on a nullable column to `NOT (ownerId = ?)`,
   * which is NULL for an ownerless community and would silently drop those
   * rows from discovery entirely.
   *
   * Deliberately NOT cached in Redis like the list endpoints above: the result
   * is per-viewer AND per-request by construction, so a shared cache entry
   * could only ever serve someone else's selection.
   */
  async getCommunityRecommendations(userId: string, limit = 10) {
    if (!userId) return [];

    const sampleFrom = Math.min(Math.max(limit * 8, 24), 60);

    // One query. `members: { none: … }` is an anti-join Postgres resolves with
    // the CommunityMember primary key (userId, communityId) — no per-row
    // membership lookup, and no second pass to filter joined ones out.
    const pool = await this.prisma.community.findMany({
      where: {
        deletedAt: null,
        // Campus communities are a separate, verification-gated surface with
        // its own endpoint; discovery here mirrors getAllCommunities.
        isCampusCommunity: false,
        members: { none: { userId } },
      },
      orderBy: { memberCount: 'desc' },
      take: sampleFrom,
    });

    // Every row is one the viewer is not in, so the membership fields are
    // known without asking. Emitted explicitly all the same, so the payload is
    // self-describing and no consumer has to infer state from a missing field.
    return sampleRandom(pool, limit).map((c) => ({
      ...c,
      isJoined: false,
      userRole: null,
    }));
  }

  async getCampusCommunities(
    userId: string,
    limit = 30,
    offset = 0,
    search?: string,
  ) {
    if (!userId) return [];

    const collegeId = await this.resolveCollegeId(userId);
    if (!collegeId) return [];

    const searchTerm = (search || '').trim();
    const searchWhere = searchTerm
      ? {
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' as const } },
            {
              description: {
                contains: searchTerm,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {};

    const cacheKey = `campus:${collegeId}:${limit}:${offset}`;
    // Only the unfiltered list is cached (searches are cheap, per-college scoped).
    let communities = searchTerm ? null : await this.getCachedList(cacheKey);
    if (!communities) {
      communities = await this.prisma.community.findMany({
        where: {
          deletedAt: null,
          isCampusCommunity: true,
          collegeId,
          ...searchWhere,
        },
        // Only what the campus surfaces render: the card (avatar, name,
        // description, member count, join button) and the sidebar's joined
        // list (id, name, ownerId, plus the membership fields computed below).
        //
        // The unprojected `findMany` this replaces returned every column,
        // including three that are constant for every row the query can
        // return — `deletedAt` is null, `isCampusCommunity` is true and
        // `collegeId` is the caller's, all by construction — plus `slug`,
        // `isPrivate`, `updatedAt`, `createdAt` and the two cover/media ids,
        // none of which any consumer of this endpoint reads.
        select: {
          id: true,
          name: true,
          description: true,
          avatarKey: true,
          color: true,
          memberCount: true,
          ownerId: true,
        },
        orderBy: { memberCount: 'desc' },
        take: limit,
        skip: offset,
      });
      if (!searchTerm) await this.setCachedList(cacheKey, communities, 120);
    }

    if (communities.length === 0) return [];

    const userMemberships = await this.prisma.communityMember.findMany({
      where: { userId, communityId: { in: communities.map((c) => c.id) } },
      select: { communityId: true, role: true },
    });

    const membershipMap = new Map(
      userMemberships.map((m) => [m.communityId, m.role]),
    );

    return communities.map((c) => {
      const isOwner = Boolean(c.ownerId && c.ownerId === userId);
      const isMember = membershipMap.has(c.id);
      return {
        ...c,
        isJoined: isMember || isOwner,
        userRole: isOwner ? 'OWNER' : membershipMap.get(c.id) || null,
      };
    });
  }

  async getCommunityById(id: string, userId?: string) {
    const t0 = Date.now();

    // Check Redis first for a cached detail response
    let community = await this.getCachedCommunity(id);
    if (!community) {
      community = await this.prisma.community.findUnique({
        where: { id },
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          college: {
            select: { id: true, name: true, shortName: true },
          },
          members: {
            take: CommunitiesService.MEMBER_STRIP_LIMIT,
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
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
          _count: {
            select: {
              members: {
                where: { user: { deletedAt: null, accountStatus: 'ACTIVE' } },
              },
              posts: { where: { deletedAt: null } },
            },
          },
        },
      });

      if (!community) {
        throw new NotFoundException('COMMUNITY_NOT_FOUND');
      }

      if (community.deletedAt) {
        throw new NotFoundException('COMMUNITY_DELETED');
      }

      const baseForCache = { ...community };
      await this.setCachedCommunity(id, baseForCache, 60);
    }

    if (
      community.ownerId &&
      community.owner &&
      !community.members.some((m: any) => m.userId === community.ownerId)
    ) {
      community.members.unshift({
        userId: community.owner.id,
        communityId: community.id,
        joinedAt: community.createdAt,
        role: 'OWNER' as any,
        user: community.owner,
      } as any);
    }

    /**
     * Everything this viewer needs on top of the shared community body.
     *
     * The four reads below used to run strictly one after another — block
     * list, presence, the viewer's college, the online count — and the client
     * made a fifth HTTP request of its own for the moderator notice. None of
     * them depends on another, so the page paid the sum where it only ever
     * needed the slowest.
     *
     * The two viewer-membership reads are deliberately NOT in this batch.
     * Making them unconditional so they could join it measured SLOWER on the
     * common case (a small community whose viewer is already in the loaded
     * strip): it turns two reads that usually cost nothing into two the
     * database always serves. They are resolved below instead, from the strip
     * when the strip can answer, and from the database only when it cannot.
     */
    const loadedMemberIds: string[] = (community.members || [])
      .map((m: any) => m.userId)
      .filter(Boolean);

    const needsCollege = Boolean(
      userId && community.isCampusCommunity && community.collegeId,
    );

    const [visibleIdList, presenceMap, viewerCollegeId, onlineCount] =
      await Promise.all([
        // Hide blocked members from this viewer only. Membership itself is
        // never touched by a block — both users stay in the community with
        // full access — so this filters the loaded strip and nothing else.
        // `_count.members` is left alone deliberately: the count must stay
        // accurate ("2,341 members") even though some of them are not
        // rendered for this viewer.
        //
        // Applied after the viewer-independent Redis cache is read, so one
        // cached community body can still serve every viewer with a different
        // block list.
        userId && loadedMemberIds.length
          ? this.blocksService.filterBlockedUsers(userId, loadedMemberIds)
          : Promise.resolve(null),
        // Fetched for every loaded member rather than only the unblocked ones,
        // which is what lets it run alongside the block query instead of after
        // it. The strip is capped, so this is at most a few dozen extra keys
        // in an MGET that was already being issued, and the entries for
        // filtered-out members are simply never read.
        loadedMemberIds.length
          ? this.presenceService.getPresenceMany(loadedMemberIds)
          : Promise.resolve(new Map()),
        needsCollege ? this.resolveCollegeId(userId!) : Promise.resolve(null),
        this.countOnlineMembers(id, community.ownerId),
      ]);

    /**
     * The viewer's own membership.
     *
     * Taken from the loaded strip when the strip is complete — that is the
     * overwhelmingly common case and it costs nothing. The strip is capped at
     * MEMBER_STRIP_LIMIT, though, and when it comes back full it may be a
     * window onto a larger membership: a genuine member outside that window
     * was previously reported as `isJoined: false` with a null role, and shown
     * a Join button for a community they were already in. So when the strip is
     * full AND the viewer is not in it, and only then, ask the database.
     *
     * The row also carries the moderator-notice timestamps, so the notice
     * below costs no query of its own either way.
     */
    const rawMembers: any[] = community.members || [];
    let viewerMembership: {
      role: string;
      moderatorPromotedAt: Date | null;
      moderatorNoticeAckedAt: Date | null;
    } | null = null;

    if (userId) {
      const fromStrip = rawMembers.find((m: any) => m.userId === userId);
      if (fromStrip) {
        viewerMembership = {
          role: fromStrip.role,
          moderatorPromotedAt: fromStrip.moderatorPromotedAt ?? null,
          moderatorNoticeAckedAt: fromStrip.moderatorNoticeAckedAt ?? null,
        };
      } else if (rawMembers.length >= CommunitiesService.MEMBER_STRIP_LIMIT) {
        viewerMembership = await this.prisma.communityMember.findUnique({
          where: { userId_communityId: { userId, communityId: id } },
          select: {
            role: true,
            moderatorPromotedAt: true,
            moderatorNoticeAckedAt: true,
          },
        });
      }
    }

    if (visibleIdList) {
      const visibleIds = new Set(visibleIdList);
      community.members = community.members.filter((m: any) =>
        visibleIds.has(m.userId),
      );
    }

    if (community.members) {
      community.members.forEach((m: any) => {
        if (community.ownerId && m.userId === community.ownerId) {
          m.role = 'OWNER';
        }
        const pres = presenceMap.get(m.userId);
        const isOnline = pres?.status === 'online';
        m.isOnline = isOnline;
        m.online = isOnline;
        if (m.user) {
          m.user.isOnline = isOnline;
          m.user.online = isOnline;
          m.user.lastActive = pres?.lastSeen || null;
        }
      });
    }

    const isOwner = Boolean(
      userId && community.ownerId && community.ownerId === userId,
    );
    const isJoined = !!viewerMembership || isOwner;
    const userRole = isOwner ? 'OWNER' : viewerMembership?.role || null;

    // Eligibility check for Campus communities
    let isEligibleToJoin = true;
    let eligibilityMessage: string | null = null;

    if (community.isCampusCommunity && community.collegeId) {
      if (!viewerCollegeId || viewerCollegeId !== community.collegeId) {
        isEligibleToJoin = false;
        const collegeName = community.college?.name || 'this college';
        eligibilityMessage = `You're not eligible to join this community. This community is limited to verified students of ${collegeName}.`;
      }
    }

    // Pending join request check for Private communities.
    //
    // Only for a non-member of a private community — the one case whose answer
    // can be anything but false. Issuing it unconditionally so it could join
    // the batch above meant every member of every private community paid for a
    // lookup whose result was thrown away.
    let hasPendingRequest = false;
    if (userId && community.isPrivate && !isJoined) {
      const pendingReq = await this.prisma.communityJoinRequest.findUnique({
        where: { communityId_userId: { communityId: id, userId } },
        select: { status: true },
      });
      hasPendingRequest = pendingReq?.status === 'PENDING';
    }

    /**
     * The pending "you're now a moderator" notice, carried on the community.
     *
     * The doc comment on `getModeratorNotice` has always claimed this travels
     * with the community "so opening it costs no extra round trip", but the
     * client had to ask a separate endpoint for it — with `staleTime: 0`, so
     * every mount and every window focus fired another request, for every
     * viewer, the overwhelming majority of whom are not moderators and get
     * `null`. The timestamps needed to answer it are already on the membership
     * row read above, so this now costs nothing and the request is gone.
     *
     * `GET :id/moderator-notice` is unchanged and still served, for any client
     * that has not been updated.
     */
    const moderatorNotice = this.pendingModeratorNotice(viewerMembership);

    const canViewPosts = isJoined || (!community.isPrivate && isEligibleToJoin);

    return {
      ...community,
      isJoined,
      online: onlineCount,
      onlineCount,
      userRole,
      isEligibleToJoin,
      eligibilityMessage,
      canViewPosts,
      hasPendingRequest,
      moderatorNotice,
    };
  }

  /**
   * How many of a community's members are online right now.
   *
   * Counted over *every* member, not over the 50 loaded for the member
   * strip — that cap is why a large community could show "0 active now"
   * while plenty of people were on. Deliberately computed outside the 60s
   * community cache: a cached presence count is worse than none, because it
   * keeps reporting people who left minutes ago.
   *
   * One indexed id-only read plus a single Redis MGET, so this stays cheap
   * even on a community with thousands of members.
   */
  async countOnlineMembers(
    communityId: string,
    ownerId?: string | null,
  ): Promise<number> {
    try {
      const members = await this.prisma.communityMember.findMany({
        where: { communityId },
        select: { userId: true },
      });

      const ids = new Set(members.map((m) => m.userId));
      // The owner is shown in the member strip whether or not they hold a
      // CommunityMember row, so they must count the same way.
      if (ownerId) ids.add(ownerId);
      if (ids.size === 0) return 0;

      // Chunked, because this is one MGET per community view over every member
      // the community has. Redis executes a command to completion on its single
      // thread, so a ten-thousand-key MGET is ten thousand lookups during which
      // no other client — the session store and the job queues share this
      // instance — is served. Slicing it bounds that stall; the answer is
      // identical, since the counts are summed either way.
      const allIds = [...ids];
      const CHUNK = 500;
      let online = 0;
      for (let i = 0; i < allIds.length; i += CHUNK) {
        const presence = await this.presenceService.getPresenceMany(
          allIds.slice(i, i + CHUNK),
        );
        for (const p of presence.values()) {
          if (p?.status === 'online') online += 1;
        }
      }
      return online;
    } catch (err) {
      // A presence read must never take the community page down with it.
      this.logger.warn(`Failed to count online members for ${communityId}`);
      return 0;
    }
  }

  /** Every community a user belongs to (or owns). Used to fan a presence
   *  change out to exactly the rooms whose count just moved. */
  async getCommunityIdsForUser(userId: string): Promise<string[]> {
    try {
      const [memberships, owned] = await Promise.all([
        this.prisma.communityMember.findMany({
          where: { userId },
          select: { communityId: true },
        }),
        this.prisma.community.findMany({
          where: { ownerId: userId, deletedAt: null },
          select: { id: true },
        }),
      ]);
      return [
        ...new Set([
          ...memberships.map((m) => m.communityId),
          ...owned.map((c) => c.id),
        ]),
      ];
    } catch {
      return [];
    }
  }

  async joinCommunity(communityId: string, userId: string) {
    // The verification check and the community read are independent; the
    // join used to wait for the first before starting the second. The
    // community is also projected now — the `include` pulled every column of
    // the row, of which this method reads six.
    const [user, community] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { verificationStatus: true },
      }),
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: {
          deletedAt: true,
          isPrivate: true,
          isCampusCommunity: true,
          collegeId: true,
          ownerId: true,
          memberCount: true,
          college: { select: { name: true } },
        },
      }),
    ]);
    if (!user || user.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException('Verify your account to join communities');
    }
    if (!community || community.deletedAt)
      throw new NotFoundException('Community not found');

    // 1. Campus Eligibility Check
    if (community.isCampusCommunity && community.collegeId) {
      const userCollegeId = await this.resolveCollegeId(userId);
      if (!userCollegeId || userCollegeId !== community.collegeId) {
        const collegeName = community.college?.name || 'this college';
        throw new ForbiddenException(
          `You're not eligible to join this community. This community is limited to verified students of ${collegeName}.`,
        );
      }
    }

    // 2. Private Community Join Request Workflow
    if (community.isPrivate) {
      const existingMember = await this.prisma.communityMember.findUnique({
        where: { userId_communityId: { userId, communityId } },
      });
      if (existingMember)
        return { success: true, status: 'MEMBER', isJoined: true };

      await this.prisma.communityJoinRequest.upsert({
        where: { communityId_userId: { communityId, userId } },
        create: { communityId, userId, status: 'PENDING' },
        update: { status: 'PENDING' },
      });

      if (community.ownerId) {
        this.domainEventService.emit('community.joinRequested', {
          communityId,
          userId,
          ownerId: community.ownerId,
        });
      }

      return {
        success: true,
        status: 'PENDING',
        hasPendingRequest: true,
        message: 'Join request submitted to moderators.',
      };
    }

    // 3. Public or Campus Community -> Direct Instant Join
    const lockKey = `toggle:join:${userId}:${communityId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      let newCount = community.memberCount;
      const joined = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.communityMember.findUnique({
          where: { userId_communityId: { userId, communityId } },
        });
        if (existing) return false;

        await tx.communityMember.create({
          data: { userId, communityId, role: 'MEMBER' },
        });
        const updated = await tx.community.update({
          where: { id: communityId },
          data: { memberCount: { increment: 1 } },
          select: { memberCount: true },
        });
        newCount = updated.memberCount;
        return true;
      });

      if (joined) {
        this.domainEventService.emit('community.memberJoined', {
          communityId,
          userId,
          memberCount: newCount,
        });
        await this.invalidateCommunityCache(
          communityId,
          community.collegeId ?? undefined,
        );
      }

      return { success: true, status: 'MEMBER', isJoined: true };
    });
  }

  async getPendingRequests(communityId: string, requestingUserId: string) {
    // Two independent lookups, previously awaited one after the other for
    // every request that only needed to know whether the caller may act.
    const [member, community] = await Promise.all([
      this.prisma.communityMember.findUnique({
        where: {
          userId_communityId: { userId: requestingUserId, communityId },
        },
        select: { role: true },
      }),
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: { ownerId: true },
      }),
    ]);

    const isOwnerOrMod =
      community?.ownerId === requestingUserId ||
      roleCan(member?.role, 'REVIEW_JOIN_REQUESTS');
    if (!isOwnerOrMod) {
      throw new ForbiddenException(
        'Only community owners or moderators can view join requests',
      );
    }

    return this.prisma.communityJoinRequest.findMany({
      where: { communityId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
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
    });
  }

  async acceptJoinRequest(
    communityId: string,
    requestId: string,
    requestingUserId: string,
  ) {
    // Two independent lookups, previously awaited one after the other for
    // every request that only needed to know whether the caller may act.
    const [member, community] = await Promise.all([
      this.prisma.communityMember.findUnique({
        where: {
          userId_communityId: { userId: requestingUserId, communityId },
        },
        select: { role: true },
      }),
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: { ownerId: true, collegeId: true },
      }),
    ]);

    const isOwnerOrMod =
      community?.ownerId === requestingUserId ||
      roleCan(member?.role, 'REVIEW_JOIN_REQUESTS');
    if (!isOwnerOrMod) {
      throw new ForbiddenException(
        'Only community owners or moderators can manage join requests',
      );
    }

    const joinReq = await this.prisma.communityJoinRequest.findUnique({
      where: { id: requestId },
    });
    if (!joinReq || joinReq.communityId !== communityId) {
      throw new NotFoundException('Join request not found');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: joinReq.userId },
      select: { verificationStatus: true },
    });
    if (!targetUser || targetUser.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException('The requesting user is not verified');
    }

    let newMemberCount = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.communityJoinRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      });
      await tx.communityMember.upsert({
        where: { userId_communityId: { userId: joinReq.userId, communityId } },
        create: { userId: joinReq.userId, communityId, role: 'MEMBER' },
        update: {},
      });
      const updated = await tx.community.update({
        where: { id: communityId },
        data: { memberCount: { increment: 1 } },
        select: { memberCount: true },
      });
      newMemberCount = updated.memberCount;
    });

    await this.invalidateCommunityCache(
      communityId,
      community?.collegeId ?? undefined,
    );
    this.domainEventService.emit('community.requestAccepted', {
      communityId,
      userId: joinReq.userId,
      memberCount: newMemberCount,
    });
    return { success: true };
  }

  async declineJoinRequest(
    communityId: string,
    requestId: string,
    requestingUserId: string,
  ) {
    // Two independent lookups, previously awaited one after the other for
    // every request that only needed to know whether the caller may act.
    const [member, community] = await Promise.all([
      this.prisma.communityMember.findUnique({
        where: {
          userId_communityId: { userId: requestingUserId, communityId },
        },
        select: { role: true },
      }),
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: { ownerId: true },
      }),
    ]);

    const isOwnerOrMod =
      community?.ownerId === requestingUserId ||
      roleCan(member?.role, 'REVIEW_JOIN_REQUESTS');
    if (!isOwnerOrMod) {
      throw new ForbiddenException(
        'Only community owners or moderators can manage join requests',
      );
    }

    const joinReq = await this.prisma.communityJoinRequest.findUnique({
      where: { id: requestId },
    });
    if (!joinReq || joinReq.communityId !== communityId) {
      throw new NotFoundException('Join request not found');
    }

    await this.prisma.communityJoinRequest.update({
      where: { id: requestId },
      data: { status: 'DECLINED' },
    });

    this.domainEventService.emit('community.requestDeclined', {
      communityId,
      userId: joinReq.userId,
    });
    return { success: true };
  }

  async leaveCommunity(communityId: string, userId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: {
        deletedAt: true,
        ownerId: true,
        collegeId: true,
        memberCount: true,
      },
    });
    if (!community || community.deletedAt)
      throw new NotFoundException('Community not found');

    if (community.ownerId === userId) {
      throw new ForbiddenException(
        'Community owner cannot leave without transferring ownership',
      );
    }

    const lockKey = `toggle:join:${userId}:${communityId}`;

    return this.redisService.withLock(lockKey, 2000, async () => {
      let newCount = community.memberCount;
      const left = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.communityMember.findUnique({
          where: { userId_communityId: { userId, communityId } },
        });
        if (!existing) return false;

        await tx.communityMember.delete({
          where: { userId_communityId: { userId, communityId } },
        });
        const updated = await tx.community.update({
          where: { id: communityId },
          data: { memberCount: { decrement: 1 } },
          select: { memberCount: true },
        });
        newCount = Math.max(0, updated.memberCount);
        return true;
      });

      if (left) {
        this.domainEventService.emit('community.memberLeft', {
          communityId,
          userId,
          memberCount: newCount,
        });
        await this.invalidateCommunityCache(
          communityId,
          community.collegeId ?? undefined,
        );
      }

      return { success: true };
    });
  }

  /**
   * Accepts only values that can actually resolve to an image, and drops
   * anything else.
   *
   * The create form used to seed this field with the community's initial letter
   * when no picture was chosen, so rows were persisted with avatarKey "H" / "J".
   * The client renders a bare string as /api/media/<value>, so every paint fired
   * a request the media route rejected as a malformed key. A placeholder initial
   * is presentation and is derived from the name at render time; it must never be
   * stored here.
   *
   * Valid shapes: a storage object key ("communities/ab12.webp"), an
   * /api/media/... path, or an absolute http(s) URL for external avatars.
   */
  private sanitizeMediaRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith('/api/media/')) return v;
    if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(v)) return v;
    return null;
  }

  async createCommunity(data: any, creatorId: string) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { verificationStatus: true },
    });
    if (!creator || creator.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException('Verify your account to create communities');
    }

    const rawSlug = (data.name || 'community')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const slug = rawSlug || `community-${Date.now()}`;
    const existing = await this.prisma.community.findUnique({
      where: { slug },
    });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    // Every new community starts with the platform defaults, stored on the
    // row exactly like an upload would be. Not a render-time fallback: the
    // record genuinely carries an image reference from the moment it exists,
    // so the community looks finished everywhere immediately and the admin
    // can replace it through the ordinary crop-and-upload flow.
    const avatarVal =
      this.sanitizeMediaRef(data.avatarKey ?? data.avatar) ??
      this.defaultAssets.refFor('community-avatar');
    // Cover starts as null — the frontend renders the theme-aware empty cover
    // state via CSS (--empty-cover-bg) when no image has been uploaded.
    const coverVal =
      this.sanitizeMediaRef(data.coverKey ?? data.coverImage) ?? null;
    const descVal = data.description || data.desc;

    const createData: any = {
      name: data.name,
      description: descVal,
      avatarKey: avatarVal,
      coverKey: coverVal,
      slug: finalSlug,
      memberCount: 1,
      owner: { connect: { id: creatorId } },
      isPrivate:
        data.isPrivate !== undefined
          ? Boolean(data.isPrivate)
          : data.privacy === 'private',
      // The colour picked at creation. It was never written, so every community
      // fell back to the theme primary wherever it was drawn without a picture,
      // and the palette choice made in the create dialog was silently discarded.
      color:
        typeof data.color === 'string' && data.color.trim()
          ? data.color.trim().slice(0, 200)
          : null,
      members: {
        create: [{ userId: creatorId, role: 'OWNER' }],
      },
    };

    if (data.isCampusCommunity || data.privacy === 'campus') {
      const user = await this.prisma.user.findUnique({
        where: { id: creatorId },
        select: { collegeId: true },
      });
      if (user?.collegeId) {
        createData.isCampusCommunity = true;
        createData.college = { connect: { id: user.collegeId } };
      }
    }

    if (avatarVal && typeof avatarVal === 'string') {
      if (avatarVal.startsWith('/api/media/')) {
        createData.avatarMedia = {
          connect: { objectKey: avatarVal.replace('/api/media/', '') },
        };
      } else if (avatarVal.startsWith('http')) {
        createData.avatarMedia = {
          connectOrCreate: {
            where: { objectKey: avatarVal },
            create: {
              provider: 'external',
              bucket: 'external',
              objectKey: avatarVal,
              mimeType: 'image/jpeg',
              fileSize: 0,
              ownerId: creatorId,
            },
          },
        };
      }
    }

    if (coverVal && typeof coverVal === 'string') {
      if (coverVal.startsWith('/api/media/')) {
        createData.coverMedia = {
          connect: { objectKey: coverVal.replace('/api/media/', '') },
        };
      } else if (coverVal.startsWith('http')) {
        createData.coverMedia = {
          connectOrCreate: {
            where: { objectKey: coverVal },
            create: {
              provider: 'external',
              bucket: 'external',
              objectKey: coverVal,
              mimeType: 'image/jpeg',
              fileSize: 0,
              ownerId: creatorId,
            },
          },
        };
      }
    }

    let created: any;
    try {
      created = await this.prisma.community.create({
        data: createData,
        include: {
          members: {
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
          _count: {
            select: { members: true, posts: true },
          },
        },
      });
    } catch (err) {
      if (avatarVal) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(avatarVal, creatorId)
          .catch(() => {});
      }
      if (coverVal) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(coverVal, creatorId)
          .catch(() => {});
      }
      throw err;
    }

    this.domainEventService.emit('community.created', {
      communityId: created.id,
      creatorId,
      community: created,
    });
    await this.invalidateCommunityCache(created.id);
    return created;
  }

  async updateCommunity(
    communityId: string,
    data: any,
    requestingUserId: string,
  ) {
    const [community, member] = await Promise.all([
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: { ownerId: true, avatarKey: true, coverKey: true },
      }),
      this.prisma.communityMember.findUnique({
        where: {
          userId_communityId: { userId: requestingUserId, communityId },
        },
        select: { role: true },
      }),
    ]);
    if (!community) throw new NotFoundException('Community not found');

    const isOwner =
      community.ownerId === requestingUserId || member?.role === 'OWNER';

    if (!isOwner) {
      throw new ForbiddenException(
        'Only the community owner can update community info',
      );
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined || data.desc !== undefined) {
      updateData.description = data.description || data.desc;
    }
    if (data.isPrivate !== undefined) {
      updateData.isPrivate = Boolean(data.isPrivate);
    }
    if (data.color !== undefined) {
      updateData.color =
        typeof data.color === 'string' && data.color.trim()
          ? data.color.trim().slice(0, 200)
          : null;
    }

    const rawAvatarInput =
      data.avatarKey !== undefined ? data.avatarKey : data.avatar;
    // Clearing the avatar is an explicit action (sending null or empty string);
    // only a non-empty value that cannot be a media reference is discarded.
    const avatarInput =
      rawAvatarInput === null || rawAvatarInput === ''
        ? null
        : this.sanitizeMediaRef(rawAvatarInput);

    if (rawAvatarInput !== undefined) {
      updateData.avatarKey = avatarInput;
      if (avatarInput && typeof avatarInput === 'string') {
        if (avatarInput.startsWith('/api/media/')) {
          updateData.avatarMedia = {
            connect: { objectKey: avatarInput.replace('/api/media/', '') },
          };
        } else if (avatarInput.startsWith('http')) {
          updateData.avatarMedia = {
            connectOrCreate: {
              where: { objectKey: avatarInput },
              create: {
                provider: 'external',
                bucket: 'external',
                objectKey: avatarInput,
                mimeType: 'image/jpeg',
                fileSize: 0,
                ownerId: requestingUserId,
              },
            },
          };
        }
      } else {
        updateData.avatarMediaId = null;
      }
    }

    const coverInput =
      data.coverKey !== undefined ? data.coverKey : data.coverImage;
    if (coverInput !== undefined) {
      updateData.coverKey = coverInput || null;
      if (coverInput && typeof coverInput === 'string') {
        if (coverInput.startsWith('/api/media/')) {
          updateData.coverMedia = {
            connect: { objectKey: coverInput.replace('/api/media/', '') },
          };
        } else if (coverInput.startsWith('http')) {
          updateData.coverMedia = {
            connectOrCreate: {
              where: { objectKey: coverInput },
              create: {
                provider: 'external',
                bucket: 'external',
                objectKey: coverInput,
                mimeType: 'image/jpeg',
                fileSize: 0,
                ownerId: requestingUserId,
              },
            },
          };
        }
      } else {
        updateData.coverMediaId = null;
      }
    }

    let updated: any;
    try {
      updated = await this.prisma.community.update({
        where: { id: communityId },
        data: updateData,
      });
    } catch (err) {
      if (avatarInput) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(avatarInput, requestingUserId)
          .catch(() => {});
      }
      if (coverInput) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(coverInput, requestingUserId)
          .catch(() => {});
      }
      throw err;
    }

    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'COMMUNITY_AVATAR',
      entityId: communityId,
      previous: community.avatarKey,
      next: updated.avatarKey,
      ownerId: requestingUserId,
      submitted: rawAvatarInput !== undefined,
    });

    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'COMMUNITY_COVER',
      entityId: communityId,
      previous: community.coverKey,
      next: updated.coverKey,
      ownerId: requestingUserId,
      submitted: coverInput !== undefined,
    });

    this.domainEventService.emit('community.updated', {
      communityId,
      community: updated,
    });
    await this.invalidateCommunityCache(communityId);
    return updated;
  }

  /**
   * Tell a new moderator they have been promoted.
   *
   * Fire-and-forget: the role change has already committed, and a notification
   * failure must not surface to the owner as a failed promotion they retry.
   */
  private notifyModeratorPromotion(
    communityId: string,
    memberId: string,
    actorId: string,
  ): void {
    (async () => {
      const [actor, community] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: actorId },
          select: { id: true, username: true, displayName: true, avatar: true },
        }),
        this.prisma.community.findUnique({
          where: { id: communityId },
          select: { id: true, name: true, avatarKey: true },
        }),
      ]);

      const dto = this.notificationFactory.createModeratorPromotion(actor, {
        recipientId: memberId,
        communityId,
        communityName: community?.name ?? null,
        communityAvatar: community?.avatarKey ?? null,
      });
      if (dto) await this.notificationsService.createNotification(dto);
    })().catch((err) =>
      this.logger.warn('Failed to send moderator promotion notification', err),
    );
  }

  /**
   * The pending welcome notice for this viewer, or null.
   *
   * Returned with the community so opening it costs no extra round trip — the
   * modal has to appear on the next open, and a second request would let the
   * page paint first and pop the modal in afterwards.
   */
  async getModeratorNotice(communityId: string, userId: string) {
    if (!userId) return null;
    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: {
        role: true,
        moderatorPromotedAt: true,
        moderatorNoticeAckedAt: true,
      },
    });
    return this.pendingModeratorNotice(member);
  }

  /**
   * Acknowledge the welcome notice. Idempotent — a double tap, or two tabs,
   * simply stamps a later time on an already-acknowledged notice.
   */
  async acknowledgeModeratorNotice(communityId: string, userId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException('Member not found in community');

    await this.prisma.communityMember.update({
      where: { userId_communityId: { userId, communityId } },
      data: { moderatorNoticeAckedAt: new Date() },
    });
    return { success: true };
  }

  async updateMemberRole(
    communityId: string,
    memberId: string,
    newRole: 'MODERATOR' | 'MEMBER',
    requestingUserId: string,
  ) {
    // Re-checked here, not just in the DTO. This endpoint must never be able
    // to grant ownership: an OWNER row satisfies every owner check in this
    // service, so accepting it would hand over the community. The value was
    // previously cast with `as any` straight into the update.
    if (newRole !== 'MODERATOR' && newRole !== 'MEMBER') {
      throw new ForbiddenException('Role must be MODERATOR or MEMBER');
    }

    // The community, the caller's role and the target's row are all
    // independent reads; they were three sequential round trips.
    const [community, requesterMember, targetMember] = await Promise.all([
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: { ownerId: true },
      }),
      this.prisma.communityMember.findUnique({
        where: {
          userId_communityId: { userId: requestingUserId, communityId },
        },
        select: { role: true },
      }),
      this.prisma.communityMember.findUnique({
        where: { userId_communityId: { userId: memberId, communityId } },
        select: { role: true },
      }),
    ]);
    if (!community) throw new NotFoundException('Community not found');

    const isOwner =
      community.ownerId === requestingUserId ||
      requesterMember?.role === 'OWNER';
    if (!isOwner) {
      throw new ForbiddenException(
        'Only the community owner can manage member roles',
      );
    }

    if (memberId === community.ownerId) {
      throw new ForbiddenException(
        'Cannot modify the role of the community owner',
      );
    }

    if (!targetMember)
      throw new NotFoundException('Member not found in community');

    // A promotion is only a promotion if the role actually changes. Re-issuing
    // MODERATOR on someone who already holds it must not re-arm the welcome
    // modal or fire a second notification — an owner tapping twice, or a
    // retried request, would otherwise pester them for nothing.
    const isPromotion =
      newRole === 'MODERATOR' && targetMember.role !== 'MODERATOR';

    const updated = await this.prisma.communityMember.update({
      where: { userId_communityId: { userId: memberId, communityId } },
      data: {
        role: newRole,
        // Stamped at the moment of promotion. The welcome modal is pending
        // while this is newer than the acknowledgement, so a later demote +
        // re-promote correctly shows it again.
        ...(isPromotion ? { moderatorPromotedAt: new Date() } : {}),
      },
    });

    this.domainEventService.emit('community.roleUpdated', {
      communityId,
      memberId,
      newRole,
    });
    await this.invalidateCommunityCache(communityId);

    // Told at the point of promotion, so it reaches them whether or not they
    // reopen the community. The in-community modal is the richer version of
    // the same news, not a replacement for it.
    if (isPromotion) {
      this.notifyModeratorPromotion(communityId, memberId, requestingUserId);

      // Pushed straight to the promoted member as well as written to their
      // notifications. If they have the community open right now, waiting for
      // them to close and reopen it before telling them they are a moderator
      // is a strange way to hand someone a job — and they are the likeliest
      // person to be looking at it, since the owner probably just told them.
      //
      // Targeted at them specifically rather than broadcast to the community
      // room: the welcome modal is theirs alone, and the room carries every
      // member. `community.roleUpdated` above still goes to the room for the
      // member-list refresh everyone needs.
      this.domainEventService.emit(
        'community:moderator_promoted',
        { communityId },
        [memberId],
      );
    }

    return updated;
  }

  async removeMember(
    communityId: string,
    memberId: string,
    requestingUserId: string,
  ) {
    const [community, requester, memberToRemove] = await Promise.all([
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: { ownerId: true },
      }),
      this.prisma.communityMember.findUnique({
        where: {
          userId_communityId: { userId: requestingUserId, communityId },
        },
        select: { role: true },
      }),
      this.prisma.communityMember.findUnique({
        where: { userId_communityId: { userId: memberId, communityId } },
        select: { role: true },
      }),
    ]);
    if (!community) throw new NotFoundException('Community not found');

    const isOwner =
      community.ownerId === requestingUserId || requester?.role === 'OWNER';
    const isMod = requester?.role === 'MODERATOR';

    // Asked against the capability table rather than the role name, so the
    // permission the owner was shown at promotion time is the permission
    // enforced here. See moderator-permissions.ts.
    if (!isOwner && !roleCan(requester?.role, 'REMOVE_MEMBERS')) {
      throw new ForbiddenException(
        'Only the owner or moderators can remove members',
      );
    }

    if (!memberToRemove) throw new NotFoundException('Member not found');

    if (memberId === community.ownerId || memberToRemove.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the community owner');
    }

    if (isMod && memberToRemove.role === 'MODERATOR') {
      throw new ForbiddenException('Moderators cannot remove other moderators');
    }

    let newCount = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.communityMember.delete({
        where: { userId_communityId: { userId: memberId, communityId } },
      });
      const updated = await tx.community.update({
        where: { id: communityId },
        data: { memberCount: { decrement: 1 } },
        select: { memberCount: true },
      });
      newCount = Math.max(0, updated.memberCount);
    });

    this.domainEventService.emit('community.memberLeft', {
      communityId,
      userId: memberId,
      memberCount: newCount,
    });
    await this.invalidateCommunityCache(communityId);

    return { success: true };
  }

  async deleteCommunity(communityId: string, requestingUserId: string) {
    const [community, member] = await Promise.all([
      this.prisma.community.findUnique({
        where: { id: communityId },
        select: {
          ownerId: true,
          deletedAt: true,
          collegeId: true,
          avatarKey: true,
          coverKey: true,
        },
      }),
      this.prisma.communityMember.findUnique({
        where: {
          userId_communityId: { userId: requestingUserId, communityId },
        },
        select: { role: true },
      }),
    ]);

    if (!community || community.deletedAt) {
      throw new NotFoundException('COMMUNITY_NOT_FOUND');
    }

    const isOwner =
      community.ownerId === requestingUserId || member?.role === 'OWNER';

    if (!isOwner) {
      throw new ForbiddenException(
        'Only the community owner can delete this community',
      );
    }

    const now = new Date();

    // 1. Find all post IDs (and media keys) BEFORE the transaction so we have
    //    them for R2 cleanup after commit without doing extra I/O inside the tx.
    const communityPosts = await this.prisma.post.findMany({
      where: { communityId },
      select: { id: true },
    });
    const postIds = communityPosts.map((p) => p.id);

    // Collect media object keys for every post so we can delete R2 files after.
    const postMediaRows =
      postIds.length > 0
        ? await this.prisma.media.findMany({
            where: { postId: { in: postIds } },
            select: { objectKey: true },
          })
        : [];
    const postMediaKeys = postMediaRows.map((m) => m.objectKey);

    await this.prisma.$transaction(async (tx) => {
      // ✅ 1. Soft-delete the community record
      await tx.community.update({
        where: { id: communityId },
        data: { deletedAt: now, memberCount: 0 },
      });

      if (postIds.length > 0) {
        // ✅ 2. Soft-delete all community posts
        await tx.post.updateMany({
          where: { id: { in: postIds } },
          data: { deletedAt: now },
        });

        // ✅ 3. Fully scrub all comments on community posts — same behaviour
        //       as a direct comment deletion so no original text survives in DB.
        await tx.comment.updateMany({
          where: { postId: { in: postIds } },
          data: {
            deletedAt: now,
            isDeleted: true,
            text: '',
            mentions: Prisma.DbNull,
            likeCount: 0,
          },
        });

        // Collect comment IDs for CommentLike + comment Mention cleanup.
        const commentRows = await tx.comment.findMany({
          where: { postId: { in: postIds } },
          select: { id: true },
        });
        const commentIds = commentRows.map((c) => c.id);

        // ✅ 4. Clean up likes, bookmarks, shares, hashtags, mentions, poll
        //       votes, comment likes, and join requests for those posts.
        await tx.postLike.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.postBookmark.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.postShare.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.postHashtag.deleteMany({
          where: { postId: { in: postIds } },
        });

        // Post-source mentions (sourceId = postId)
        await tx.mention.deleteMany({
          where: { sourceId: { in: postIds }, sourceType: 'POST' },
        });

        if (commentIds.length > 0) {
          // Comment-source mentions (sourceId = commentId)
          await tx.mention.deleteMany({
            where: { sourceId: { in: commentIds }, sourceType: 'COMMENT' },
          });
          // CommentLike rows
          await tx.commentLike.deleteMany({
            where: { commentId: { in: commentIds } },
          });
        }

        await tx.pollVote.deleteMany({
          where: { postId: { in: postIds } },
        });

        await tx.pollOption.deleteMany({
          where: { postId: { in: postIds } },
        });

        // Remove post Media rows — R2 files deleted after transaction commits.
        if (postMediaKeys.length > 0) {
          await tx.media.deleteMany({
            where: { objectKey: { in: postMediaKeys } },
          });
        }

        // ✅ 5. Clean up notifications related to these posts
        await tx.notification.deleteMany({
          where: { entityId: { in: postIds } },
        });
      }

      // ✅ 6. Resolve reports related to community or its posts
      await tx.report.updateMany({
        where: {
          targetId: { in: [communityId, ...postIds] },
        },
        data: { status: 'RESOLVED', actionTaken: 'Community deleted' },
      });

      // ✅ 7. Remove all community membership records
      await tx.communityMember.deleteMany({
        where: { communityId },
      });

      // ✅ 8. Remove all community join requests
      await tx.communityJoinRequest.deleteMany({
        where: { communityId },
      });
    });

    // ✅ 9. Queue physical R2 objects for durable deletion AFTER commit.
    const mediaKeysToClean = [
      community.avatarKey,
      community.coverKey,
      ...postMediaKeys,
    ].filter(Boolean) as string[];

    if (mediaKeysToClean.length > 0 && this.mediaCleanupService) {
      this.mediaCleanupService.queueMediaDeletion(mediaKeysToClean);
    }

    // ✅ 10. Invalidate all relevant Redis & local memory caches
    await this.invalidateCommunityCache(
      communityId,
      community.collegeId ?? undefined,
    );

    /**
     * One targeted delete, where there used to be two full keyspace scans.
     *
     * This block ran `KEYS 'posts:*'` and `KEYS 'feed:*'`. `KEYS` is
     * O(total keyspace) and Redis is single-threaded, so each call stalls every
     * other client for its duration — and this deployment shares Redis with the
     * session store and the job queues, so the blast radius was the whole app,
     * not this cache.
     *
     * Both patterns were also dead: no code path in this repository writes or
     * reads a `posts:*` or `feed:*` key, so the scans walked the entire
     * keyspace to build a list that was always empty. `community-posts:<id>` is
     * the only key the block ever actually named, so that is all that is
     * deleted now. It is unconditional and O(1); `DEL` on a missing key is a
     * no-op, which is cheaper than any scan that could discover its absence.
     */
    const redis = this.redisService.getClient();
    if (redis) {
      try {
        await redis.del(`community-posts:${communityId}`);
      } catch (err) {
        this.logger.warn(
          `Failed clearing Redis post keys for community ${communityId}: ${err?.message}`,
        );
      }
    }

    // ✅ 11. Emit real-time domain event so WebSockets notify all clients immediately
    this.domainEventService.emit('community.deleted', {
      communityId,
      deletedAt: now.toISOString(),
    });

    return { success: true, communityId };
  }

  /**
   * Gracefully handles communities owned by a deleting user.
   * If other members exist: reassigns ownership to the oldest moderator/member.
   * If user was sole member: soft-deletes the community and its resources.
   * Runs as part of the user deletion database transaction.
   */
  async reassignOrDeleteForUser(
    userId: string,
    tx: any,
    now = new Date(),
  ): Promise<{ mediaKeysToClean: string[] }> {
    const mediaKeysToClean: string[] = [];

    const ownedCommunities = await tx.community.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, name: true, avatarKey: true, coverKey: true },
    });

    for (const comm of ownedCommunities) {
      // Find candidate successors, prioritizing MODERATOR first, then oldest MEMBER.
      const candidates = await tx.communityMember.findMany({
        where: { communityId: comm.id, userId: { not: userId } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        select: { userId: true, role: true },
        take: 1,
      });

      if (candidates.length > 0) {
        const successor = candidates[0];
        // Transfer ownership
        await tx.community.update({
          where: { id: comm.id },
          data: { ownerId: successor.userId },
        });
        await tx.communityMember.update({
          where: {
            userId_communityId: {
              userId: successor.userId,
              communityId: comm.id,
            },
          },
          data: { role: 'OWNER' },
        });
        this.logger.log(
          `Transferred ownership of community ${comm.id} (${comm.name}) from ${userId} to ${successor.userId}`,
        );
      } else {
        // No other members: soft-delete the empty community and its posts
        await tx.community.update({
          where: { id: comm.id },
          data: { deletedAt: now, memberCount: 0, ownerId: null },
        });

        // Find community posts to clean
        const postRows = await tx.post.findMany({
          where: { communityId: comm.id },
          select: { id: true },
        });
        const postIds = postRows.map((p: any) => p.id);

        if (postIds.length > 0) {
          await tx.post.updateMany({
            where: { id: { in: postIds } },
            data: { deletedAt: now },
          });
          await tx.comment.updateMany({
            where: { postId: { in: postIds } },
            data: {
              deletedAt: now,
              isDeleted: true,
              text: '',
              mentions: Prisma.DbNull,
              likeCount: 0,
            },
          });
          await tx.postLike.deleteMany({ where: { postId: { in: postIds } } });
          await tx.postBookmark.deleteMany({
            where: { postId: { in: postIds } },
          });
          await tx.postShare.deleteMany({ where: { postId: { in: postIds } } });
          await tx.postHashtag.deleteMany({
            where: { postId: { in: postIds } },
          });
          await tx.mention.deleteMany({
            where: { sourceId: { in: postIds }, sourceType: 'POST' },
          });
          await tx.pollVote.deleteMany({ where: { postId: { in: postIds } } });
          await tx.pollOption.deleteMany({
            where: { postId: { in: postIds } },
          });
          await tx.notification.deleteMany({
            where: { entityId: { in: postIds } },
          });

          const commPostMedia = await tx.media.findMany({
            where: { postId: { in: postIds } },
            select: { objectKey: true },
          });
          commPostMedia.forEach((m: any) => mediaKeysToClean.push(m.objectKey));
        }

        if (comm.avatarKey) mediaKeysToClean.push(comm.avatarKey);
        if (comm.coverKey) mediaKeysToClean.push(comm.coverKey);

        await tx.communityJoinRequest.deleteMany({
          where: { communityId: comm.id },
        });
        await tx.communityMember.deleteMany({
          where: { communityId: comm.id },
        });
      }
    }

    return { mediaKeysToClean };
  }
}
