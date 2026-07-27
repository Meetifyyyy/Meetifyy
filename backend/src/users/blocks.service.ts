import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** TTL for the block-list cache (seconds). Blocks rarely change. */
const BLOCK_CACHE_TTL = 30;

@Injectable()
export class BlocksService {
  private readonly redis: ReturnType<RedisService['getClient']>;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.redis = this.redisService?.getClient() ?? null;
  }

  private cacheKey(userId: string) {
    return `blocks:excluded:${userId}`;
  }

  /**
   * Returns user IDs that should be excluded for the given user.
   * Includes both directions: users this user blocked AND users who blocked them.
   *
   * Result is cached in Redis for 30 seconds so the Block table is not
   * queried on every feed load, search, or activity list.
   */
  async getExcludedUserIds(userId: string): Promise<string[]> {
    // 1. Try Redis cache first (O(1) network call vs. full DB query)
    if (this.redis) {
      try {
        const cached = await this.redis.get(this.cacheKey(userId));
        if (cached) return JSON.parse(cached) as string[];
      } catch {
        // Redis unavailable — fall through to DB
      }
    }

    // 2. DB query
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

    // 3. Store in Redis with TTL
    if (this.redis) {
      try {
        await this.redis.setex(this.cacheKey(userId), BLOCK_CACHE_TTL, JSON.stringify(result));
      } catch {
        // Non-fatal — continue without cache
      }
    }

    return result;
  }

  /**
   * Invalidate the block cache for both sides of a block/unblock action.
   * Call this after any block or unblock operation to keep the cache accurate.
   */
  async invalidateBlockCache(userIdA: string, userIdB: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.cacheKey(userIdA), this.cacheKey(userIdB));
    } catch {
      // Non-fatal
    }
  }
}

