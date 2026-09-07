import { ShareCardCache } from './share-card.cache';
import { ShareCardRenderer } from './share-card.renderer';
import type { PublicSharePost } from './share-preview.service';
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

  it('separates posts', () => {
    expect(ShareCardCache.keyFor(post())).not.toBe(
      ShareCardCache.keyFor(
        post({ id: '99999999-2222-4333-8444-555555555555' }),
      ),
    );
  });
});
