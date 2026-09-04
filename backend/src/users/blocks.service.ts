import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * TTL for the block-list cache (milliseconds).
 *
 * PERF: this cache lives in-process, not in Redis. Measured from the app
 * server, a Redis round-trip costs ~67ms while the Block query it was standing
 * in for costs ~33ms — so the old Redis cache made every caller *slower* than
 * simply asking Postgres, and a cache miss cost 67 (GET) + 33 (DB) + 67 (SETEX)
 * = ~165ms. An in-process map answers in ~0ms and falls back to a single 33ms
 * query, which beats the Redis path whether it hits or misses.
 *
 * The TTL is a backstop only: writes invalidate synchronously in-process and
 * across instances via Redis pub/sub (see `invalidateBlockCache`), so this
 * bounds staleness in the pathological case where an invalidation message is
 * dropped. 5s is deliberately far tighter than the 300s bound the Redis cache
 * allowed, so block enforcement is strictly fresher than before.
 */
const BLOCK_CACHE_TTL_MS = 5_000;

/** Bounded so a large user base can't grow the map without limit. */
const BLOCK_CACHE_MAX_ENTRIES = 5_000;

/** Cross-instance cache-invalidation channel. */
const BLOCK_INVALIDATE_CHANNEL = 'meetifyy:blocks_invalidate';

/**
 * Guards the pub/sub wiring, which belongs to the caches below rather than to
 * any one service instance.
 *
 * BlocksService is named in the `providers` array of NINE modules, so Nest
 * builds nine of it — which is exactly why the caches are static. The
 * subscription was not deduplicated the same way, so every one of those
 * instances added its own 'message' handler to the shared subscriber
 * connection, and all nine then did identical work (parse the payload, delete
 * from the same two static Maps) on every invalidation. Together with the
 * realtime gateway's handler that put the connection at Node's default ceiling
 * of ten listeners, so the next service to subscribe — whichever it happened
 * to be — tipped it into a MaxListenersExceededWarning at boot.
 *
 * One handler is all the caches need.
 */
let blockCacheSubscribed = false;

interface CachedBlocks {
  ids: string[];
  expiresAt: number;
}

/**
 * Directional cache: ids this user has blocked, WITHOUT the ids of users who
 * blocked them. Kept separate from the mutual cache because almost every
 * caller wants the mutual answer, and mixing the two behind one key is how
 * "they blocked me" ends up mislabelled as "I blocked them".
 */
interface CachedOutgoingBlocks {
  ids: string[];
  expiresAt: number;
}

@Injectable()
export class BlocksService implements OnModuleInit, OnModuleDestroy {
  private readonly redis: ReturnType<RedisService['getClient']>;

  /**
   * Process-local block-list cache. Static so every injected copy of the
   * service shares one map (Nest can instantiate per-module providers).
   */
  private static readonly cache = new Map<string, CachedBlocks>();

  /** @see CachedOutgoingBlocks */
  private static readonly outgoingCache = new Map<
    string,
    CachedOutgoingBlocks
  >();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.redis = this.redisService?.getClient() ?? null;
  }

  /**
   * Listen for invalidations published by other backend instances so a block
   * made on one replica clears the in-process caches on all of them — the same
   * real-time guarantee the shared Redis key used to provide.
   */
  onModuleInit() {
    if (blockCacheSubscribed) return;

    const subClient = this.redisService?.getSubClient();
    if (!subClient) return;

    subClient.subscribe(BLOCK_INVALIDATE_CHANNEL, () => {
      // Subscribe errors are non-fatal: the TTL still bounds staleness.
    });
    subClient.on('message', (channel: string, message: string) => {
      if (channel !== BLOCK_INVALIDATE_CHANNEL) return;
      try {
        const userIds = JSON.parse(message) as string[];
        for (const id of userIds) {
          BlocksService.cache.delete(id);
          BlocksService.outgoingCache.delete(id);
        }
      } catch {
        // Malformed payload — ignore.
      }
    });

    blockCacheSubscribed = true;
  }

  /**
   * Releases the subscription guard so a torn-down process (or a test that
   * builds a fresh module) can wire it up again.
   */
  onModuleDestroy() {
    blockCacheSubscribed = false;
  }

  /**
   * Low-level primitive: user IDs that should be excluded for the given user,
   * in both directions (users they blocked AND users who blocked them).
   *
   * Prefer `isBlocked` / `filterBlockedUsers` / `injectBlockFilter` — this stays
   * public for the few callers that need the raw set to build a bespoke query.
   */
  async getExcludedUserIds(userId: string): Promise<string[]> {
    const now = Date.now();
    const cached = BlocksService.cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.ids;

    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: {
        blockerId: true,
        blockedId: true,
      },
    });

    const excludedIds = new Set<string>();
    for (const block of blocks) {
      if (block.blockerId === userId) {
        excludedIds.add(block.blockedId);
      } else {
        excludedIds.add(block.blockerId);
      }
    }

    const result = Array.from(excludedIds);
    this.setCache(userId, result);
    return result;
  }

  /**
   * True when a block exists between the two users in *either* direction.
   *
   * Block effect is mutual: only A initiates, but A and B become invisible to
   * each other, so callers never need to care who pressed the button.
   */
  async isBlocked(userA: string, userB: string): Promise<boolean> {
    if (userA === userB) return false;
    const excluded = await this.getExcludedUserIds(userA);
    return excluded.includes(userB);
  }

  /**
   * IMPORTANT: any future community member search endpoint MUST call
   * BlocksService.filterBlockedUsers(currentUserId, memberIds) before returning
   * results. Do NOT implement block logic inline in the endpoint.
   * See: audit finding 6.6.
   *
   * The same rule holds for any new endpoint that returns a list of users:
   * participant lists, invite pickers, leaderboards, "who viewed this". The
   * audit found two such lists (follower lists, activity attendees) shipped
   * without filtering because the rule lived only in reviewers' heads.
   *
   * Drops every user the viewer is blocked with from `userIds`, preserving the
   * caller's ordering. Use this for lists already in memory (participants,
   * follower lists, mention candidates); for anything still expressible as a
   * query, prefer `injectBlockFilter` so the exclusion happens in Postgres.
   */
  async filterBlockedUsers(
    currentUserId: string | null | undefined,
    userIds: string[],
  ): Promise<string[]> {
    if (!currentUserId || userIds.length === 0) return userIds;
    const excluded = await this.getExcludedUserIds(currentUserId);
    if (excluded.length === 0) return userIds;
    const excludedSet = new Set(excluded);
    return userIds.filter((id) => !excludedSet.has(id));
  }

  /**
   * Adds block exclusion to a Prisma `where` clause, so filtering happens at the
   * database level rather than after the rows are already in hand.
   *
   * `field` names the column holding the user id being filtered on — `authorId`
   * for posts, `userId` for likes, `id` when querying User itself.
   *
   * The exclusion is appended to `AND` rather than assigned onto the field,
   * because a caller may already constrain that same field (`authorId: { in }`
   * on a following-feed, say). Assigning would silently drop their constraint;
   * ANDing composes with it.
   */
  async injectBlockFilter<T extends Record<string, any>>(
    currentUserId: string | null | undefined,
    where: T,
    field = 'id',
  ): Promise<T & { AND?: any[] }> {
    if (!currentUserId) return where;
    const excluded = await this.getExcludedUserIds(currentUserId);
    if (excluded.length === 0) return where;

    const existingAnd = where.AND;
    const and = Array.isArray(existingAnd)
      ? [...existingAnd]
      : existingAnd
        ? [existingAnd]
        : [];
    and.push({ [field]: { notIn: excluded } });
    return { ...where, AND: and };
  }

  /**
   * Directional: the ids this user has blocked themselves.
   *
   * Distinct from `getExcludedUserIds`, which is mutual. Use this only where
   * the DIRECTION genuinely matters — deciding whether to offer an "Unblock"
   * affordance, or which of the two neutral messages a chat should show. For
   * visibility filtering always use the mutual helpers: who pressed the button
   * is irrelevant to who can see whom.
   */
  async getBlockedByUserIds(userId: string): Promise<string[]> {
    const now = Date.now();
    const cached = BlocksService.outgoingCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.ids;

    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    });
    const ids = rows.map((r) => r.blockedId);

    if (BlocksService.outgoingCache.size >= BLOCK_CACHE_MAX_ENTRIES) {
      for (const [k, v] of BlocksService.outgoingCache) {
        if (v.expiresAt <= now) BlocksService.outgoingCache.delete(k);
      }
      if (BlocksService.outgoingCache.size >= BLOCK_CACHE_MAX_ENTRIES) {
        const oldest = BlocksService.outgoingCache.keys().next().value;
        if (oldest) BlocksService.outgoingCache.delete(oldest);
      }
    }
    BlocksService.outgoingCache.set(userId, {
      ids,
      expiresAt: now + BLOCK_CACHE_TTL_MS,
    });
    return ids;
  }

  /** Directional: did `blockerId` block `blockedId`? */
  async hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    if (blockerId === blockedId) return false;
    const ids = await this.getBlockedByUserIds(blockerId);
    return ids.includes(blockedId);
  }

  /**
   * Both directions for one pair, in one place, so callers stop hand-rolling it.
   *
   * `blockedByThem` is derived rather than queried: the pair is related if the
   * mutual set contains them, and if this user is not the one who blocked, the
   * other side must be.
   */
  async getBlockDirection(
    userId: string,
    otherUserId: string,
  ): Promise<{
    isBlocked: boolean;
    blockedByMe: boolean;
    blockedByThem: boolean;
  }> {
    if (!userId || !otherUserId || userId === otherUserId) {
      return { isBlocked: false, blockedByMe: false, blockedByThem: false };
    }
    const [mutual, outgoing] = await Promise.all([
      this.getExcludedUserIds(userId),
      this.getBlockedByUserIds(userId),
    ]);
    const isBlocked = mutual.includes(otherUserId);
    const blockedByMe = outgoing.includes(otherUserId);
    return { isBlocked, blockedByMe, blockedByThem: isBlocked && !blockedByMe };
  }

  /**
   * The rows behind Settings -> Privacy -> Blocked Contacts.
   *
   * Lives here rather than in UsersService so that BlocksService owns every
   * read and write of the Block table — there is exactly one file to audit when
   * asking "what can touch blocks?".
   *
   * Reads only blocks this user MADE (`blockerId`). Blocks received are never
   * exposed: a user must not be able to learn that they appear on someone's
   * list. Fetches one extra row to answer `hasMore` without a COUNT.
   */
  async listBlockedContacts(blockerId: string, take: number, skip: number) {
    return this.prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: take + 1,
      select: {
        blockedId: true,
        createdAt: true,
        blocked: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            deletedAt: true,
          },
        },
      },
    });
  }

  /**
   * Removes a block. Deliberately scoped to the pair AND the direction: a user
   * can only lift a block they placed, never one placed on them.
   *
   * Cache invalidation is the caller's job (UsersService.unblockUser), since it
   * also has other caches to clear in the same breath.
   */
  async removeBlock(blockerId: string, blockedId: string) {
    const { count } = await this.prisma.block.deleteMany({
      where: { blockerId, blockedId },
    });

    // deleteMany happily reports success for a pair that was never blocked,
    // which let DELETE /api/blocks/:id return 200 for any id at all — an
    // oracle for "did I block this person?" and a silent no-op for a client
    // that got the id wrong. Absent block, absent row: 404.
    if (count === 0) {
      throw new NotFoundException('No block found for this user');
    }
    return { count };
  }

  private setCache(userId: string, ids: string[]) {
    if (BlocksService.cache.size >= BLOCK_CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of BlocksService.cache) {
        if (v.expiresAt <= now) BlocksService.cache.delete(k);
      }
      if (BlocksService.cache.size >= BLOCK_CACHE_MAX_ENTRIES) {
        const oldest = BlocksService.cache.keys().next().value;
        if (oldest) BlocksService.cache.delete(oldest);
      }
    }
    BlocksService.cache.set(userId, {
      ids,
      expiresAt: Date.now() + BLOCK_CACHE_TTL_MS,
    });
  }

  /**
   * Invalidate the block cache for both sides of a block/unblock action.
   * Call this after any block or unblock operation to keep the cache accurate.
   *
   * Clears this instance synchronously, then tells every other instance to do
   * the same. The local clear happens first so the caller's own next read is
   * always correct even if Redis is down.
   */
  async invalidateBlockCache(userIdA: string, userIdB: string): Promise<void> {
    BlocksService.cache.delete(userIdA);
    BlocksService.cache.delete(userIdB);
    BlocksService.outgoingCache.delete(userIdA);
    BlocksService.outgoingCache.delete(userIdB);

    if (!this.redis) return;
    try {
      await this.redis.publish(
        BLOCK_INVALIDATE_CHANNEL,
        JSON.stringify([userIdA, userIdB]),
      );
    } catch {
      // Non-fatal — the TTL bounds staleness on other instances.
    }
  }
}
