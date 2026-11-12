import type { Redis } from 'ioredis';
import { stub } from '../common/testing/stub';
import type { RedisService } from '../redis/redis.service';
import { ShareCardCache } from './share-card.cache';
import { ShareCardRenderer } from './share-card.renderer';
import type { PublicSharePost } from './share-preview.service';
import {
  SHARE_RENDER_MAX_CONCURRENT,
  SHARE_RENDER_MAX_QUEUED,
  ShareRenderBusyError,
} from './share-render-gate';
import { sharePost } from './testing/share-post.fixture';

/**
 * The cache key is the whole invalidation story for share cards. Nothing purges
 * it, so anything the key does not mention can never change what a viewer sees.
 */
describe('ShareCardCache — the key', () => {
  const post = (over: Partial<PublicSharePost> = {}) => sharePost(over);

  it('changes when the post is edited', () => {
    expect(ShareCardCache.keyFor(post())).not.toBe(
      ShareCardCache.keyFor(
        post({ updatedAt: new Date('2026-03-01T00:00:00.000Z') }),
      ),
    );
  });

  it('names the renderer revision, so a layout change retires every card', () => {
    // Without this the cache is keyed only on content, and a redesigned card is
    // never rendered for any post nobody has edited since — the change deploys
    // and appears to do nothing.
    expect(ShareCardCache.keyFor(post())).toContain(
      `v${ShareCardRenderer.REVISION}`,
    );
  });

  it('is stable for the same post and the same renderer', () => {
    expect(ShareCardCache.keyFor(post())).toBe(ShareCardCache.keyFor(post()));
  });

  it('separates the two variants of the same post', () => {
    // They are different images — 1200x630 flattened JPEG against a 2400x1260
    // PNG with transparent corners. One served in place of the other is either
    // a chat thumbnail four times too big or a story card with a white box
    // where the rounding should be.
    expect(ShareCardCache.keyFor(post(), 'unfurl')).not.toBe(
      ShareCardCache.keyFor(post(), 'story'),
    );
    expect(ShareCardCache.keyFor(post())).toBe(
      ShareCardCache.keyFor(post(), 'unfurl'),
    );
  });

  it('separates posts', () => {
    expect(ShareCardCache.keyFor(post())).not.toBe(
      ShareCardCache.keyFor(
        post({ id: '99999999-2222-4333-8444-555555555555' }),
      ),
    );
  });
});

/**
 * The key-level lock only serialises one card. Distinct cards used to render
 * all at once, so the render itself passes through a process-wide gate and a
 * refused card is neither served nor stored.
 */
describe('ShareCardCache — render capacity', () => {
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  const postNumber = (n: number) =>
    sharePost({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` });

  const setup = () => {
    const releases: Array<() => void> = [];
    const render = jest
      .fn<Promise<Buffer>, [PublicSharePost]>()
      .mockImplementation(
        () =>
          new Promise<Buffer>((resolve) => {
            releases.push(() => resolve(Buffer.from('jpeg')));
          }),
      );
    const set = jest.fn<Promise<'OK'>, unknown[]>().mockResolvedValue('OK');
    const client = {
      getBuffer: jest
        .fn<Promise<Buffer | null>, [string]>()
        .mockResolvedValue(null),
      set,
    };
    const cache = new ShareCardCache(
      stub<RedisService>({
        getClient: () => stub<Redis>(client),
        withLock: jest.fn(
          (_k: string, _t: number, fn: () => Promise<unknown>) => fn(),
        ),
      }),
      stub<ShareCardRenderer>({ render }),
    );
    return { cache, render, set, releases };
  };

  it('renders at most the concurrency limit of distinct cards at once', async () => {
    const { cache, render, releases } = setup();
    const pending = Array.from(
      { length: SHARE_RENDER_MAX_CONCURRENT + 3 },
      (_, i) => cache.get(postNumber(i)),
    );
    await flush();

    expect(render).toHaveBeenCalledTimes(SHARE_RENDER_MAX_CONCURRENT);

    // A finished render lets exactly one queued card start.
    releases[0]();
    await flush();
    expect(render).toHaveBeenCalledTimes(SHARE_RENDER_MAX_CONCURRENT + 1);

    while (render.mock.calls.length < pending.length || releases.length) {
      releases.shift()?.();
      await flush();
    }
    await expect(Promise.all(pending)).resolves.toHaveLength(pending.length);
  });

  it('refuses overflow with ShareRenderBusyError and stores nothing for it', async () => {
    const { cache, render, set, releases } = setup();
    const admitted = Array.from(
      { length: SHARE_RENDER_MAX_CONCURRENT + SHARE_RENDER_MAX_QUEUED },
      (_, i) => cache.get(postNumber(i)),
    );
    await flush();

    await expect(cache.get(postNumber(99))).rejects.toBeInstanceOf(
      ShareRenderBusyError,
    );
    expect(render).toHaveBeenCalledTimes(SHARE_RENDER_MAX_CONCURRENT);
    expect(set).not.toHaveBeenCalled();

    while (releases.length || render.mock.calls.length < admitted.length) {
      releases.shift()?.();
      await flush();
    }
    await Promise.all(admitted);
    // Only the admitted cards were cached; the refused one never was.
    expect(set).toHaveBeenCalledTimes(admitted.length);
    expect(
      set.mock.calls.some(([key]) => String(key).includes(postNumber(99).id)),
    ).toBe(false);
  });
});
