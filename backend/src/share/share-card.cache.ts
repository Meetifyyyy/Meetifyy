import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ShareCardRenderer } from './share-card.renderer';
import type { PublicSharePost } from './share-preview.service';
import { SharePreviewService } from './share-preview.service';

/**
 * Renders a post's card at most once per version, per cache lifetime.
 *
 * WHY THERE IS A CACHE AT ALL
 * Rendering decodes up to two photographs and rasterises an SVG. That is cheap
 * per call and ruinous per share: a link posted into a large WhatsApp group is
 * fetched once per device that displays it, and Facebook re-fetches on a
 * schedule of its own. Without a cache, one popular post is a sustained image
 * workload sharing a process with the API.
 *
 * WHY THE KEY CARRIES TWO VERSIONS
 * The key is `share:card:v<revision>:<postId>:<updatedAt>`.
 *
 * `updatedAt` covers content: editing a post moves it, so the new version
 * simply misses rather than needing anything to be purged — there is no
 * invalidation step to forget, and no window in which a stale card is served
 * under a key that claims to be current.
 *
 * `revision` covers code, and is the half that is easy to leave out. Without it
 * a change to the layout is invisible for every post nobody has edited since,
 * because the key does not mention the renderer at all. See
 * ShareCardRenderer.REVISION.
 *
 * Old entries under either version are never read again and expire on their
 * own.
 *
 * WHY REDIS FAILING IS NOT AN ERROR
 * Redis here is a cost optimisation, not a source of truth. If it is
 * unavailable the card is rendered on demand, exactly as it would have been on
 * a miss, and the HTTP layer's own cache headers still keep the CDN and the
 * crawler from asking again. Every Redis call is wrapped for that reason.
 */
@Injectable()
export class ShareCardCache {
  private readonly logger = new Logger(ShareCardCache.name);

  /**
   * Seven days. The entry is version-keyed, so this is not a staleness window —
   * it is only how long an unshared card keeps occupying memory. Long enough
   * that a post shared repeatedly over a week is rendered once.
   */
  private static readonly TTL_SECONDS = 7 * 24 * 60 * 60;

  /**
   * Ceiling on what is written to Redis.
   *
   * The renderer produces cards well under this; the guard exists so that a
   * future layout change cannot quietly start pushing multi-megabyte values
   * into a Redis whose eviction policy is `noeviction` (see the operations
   * doc). Over the limit the card is still served, just not stored.
   */
  private static readonly MAX_CACHED_BYTES = 2 * 1024 * 1024;

  constructor(
    private readonly redis: RedisService,
    private readonly renderer: ShareCardRenderer,
  ) {}

  async get(post: PublicSharePost): Promise<Buffer> {
    const key = ShareCardCache.keyFor(post);
    const client = this.redis.getClient();

    if (client) {
      try {
        // Explicitly the buffer-returning variant: `get` would decode the PNG
        // as UTF-8 and hand back a corrupted string.
        const hit = await client.getBuffer(key);
        if (hit?.length) return hit;
      } catch (error) {
        this.logger.debug(
          `share.card_cache_read_failed ${(error as Error)?.message}`,
        );
      }
    }

    // Serialised per key across the whole deployment. A post shared into a
    // group chat produces a burst of simultaneous first fetches; without this
    // every one of them renders the same card at the same moment.
    const card = await this.redis.withLock(key, 10_000, async () => {
      if (client) {
        try {
          const raced = await client.getBuffer(key);
          if (raced?.length) return raced;
        } catch {
          // Fall through and render.
        }
      }
      return this.renderer.render(post);
    });

    if (client && card.length <= ShareCardCache.MAX_CACHED_BYTES) {
      try {
        await client.set(key, card, 'EX', ShareCardCache.TTL_SECONDS);
      } catch (error) {
        this.logger.debug(
          `share.card_cache_write_failed ${(error as Error)?.message}`,
        );
      }
    }

    return card;
  }

  static keyFor(post: PublicSharePost): string {
    return `share:card:v${ShareCardRenderer.REVISION}:${post.id}:${SharePreviewService.versionToken(post)}`;
  }
}
