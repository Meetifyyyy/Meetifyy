import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
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

interface CachedBlocks {
  ids: string[];
  expiresAt: number;
}

@Injectable()
export class BlocksService implements OnModuleInit {
  private readonly redis: ReturnType<RedisService['getClient']>;

  /**
   * Process-local block-list cache. Static so every injected copy of the
   * service shares one map (Nest can instantiate per-module providers).
   */
  private static readonly cache = new Map<string, CachedBlocks>();

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
    const subClient = this.redisService?.getSubClient();
    if (!subClient) return;

    subClient.subscribe(BLOCK_INVALIDATE_CHANNEL, () => {
      // Subscribe errors are non-fatal: the TTL still bounds staleness.
    });
    subClient.on('message', (channel: string, message: string) => {
      if (channel !== BLOCK_INVALIDATE_CHANNEL) return;
      try {
        const userIds = JSON.parse(message) as string[];
        for (const id of userIds) BlocksService.cache.delete(id);
      } catch {
        // Malformed payload — ignore.
      }
    });
  }

  /**
   * Returns user IDs that should be excluded for the given user.
   * Includes both directions: users this user blocked AND users who blocked them.
   */
  async getExcludedUserIds(userId: string): Promise<string[]> {
    const now = Date.now();
    const cached = BlocksService.cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.ids;

    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: userId },
          { blockedId: userId },
        ],
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
    BlocksService.cache.set(userId, { ids, expiresAt: Date.now() + BLOCK_CACHE_TTL_MS });
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

    if (!this.redis) return;
    try {
      await this.redis.publish(BLOCK_INVALIDATE_CHANNEL, JSON.stringify([userIdA, userIdB]));
    } catch {
      // Non-fatal — the TTL bounds staleness on other instances.
    }
  }
}
