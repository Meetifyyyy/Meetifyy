import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import { FakeR2 } from './testing/fake-r2';

/**
 * A replica remembers where it last found a key. The relocation job moves
 * private-prefix objects from the main bucket to the private one, and it can
 * run on a different replica, so a remembered "main bucket" can become false
 * while the object is still perfectly readable from the other bucket.
 */
describe('reads after an object is relocated to the private bucket', () => {
  const MAIN = 'meetifyy-media';
  const PRIVATE = 'meetifyy-private';
  const KEY = 'chat/legacy.mp4';

  type Cached = { bucket: string | null; expiresAt: number };

  const build = () => {
    const r2 = new FakeR2();
    r2.put(MAIN, KEY, 'video-bytes', 'video/mp4');
    const provider = Object.create(
      CloudflareR2Provider.prototype,
    ) as CloudflareR2Provider;
    Object.assign(provider, {
      bucketName: MAIN,
      verificationBucketName: PRIVATE,
      publicUrl: 'https://pub-test.r2.dev',
      isConfigured: true,
      readBucketCache: new Map<string, Cached>(),
      s3: r2.client(),
      // Local disk is only the unconfigured fallback; keep it out of the way.
      getLocalFilePath: () => '/nonexistent/path',
    });
    const cache = (): Map<string, Cached> => provider['readBucketCache'];
    /** What the relocation job leaves behind, as seen by a replica that cached the old place. */
    const move = () => {
      r2.buckets.get(MAIN)?.delete(KEY);
      r2.put(PRIVATE, KEY, 'video-bytes', 'video/mp4');
    };
    return { r2, provider, cache, move };
  };

  it('getMetadata recovers when the cached bucket no longer has the object', async () => {
    const { provider, cache, move } = build();
    await provider.getMetadata(KEY);
    expect(cache().get(KEY)?.bucket).toBe(MAIN);

    move();

    await expect(provider.getMetadata(KEY)).resolves.toEqual({
      contentLength: 11,
      contentType: 'video/mp4',
    });
    // And remembers the new place.
    expect(cache().get(KEY)?.bucket).toBe(PRIVATE);
  });

  it('getMetadata still reports a genuine miss, without a second round of lookups for a cold key', async () => {
    const { r2, provider } = build();
    r2.buckets.get(MAIN)?.delete(KEY);

    await expect(provider.getMetadata(KEY)).resolves.toBeNull();
    // Private, main (resolve), then the one head that confirms the miss.
    expect(r2.sent('HeadObjectCommand')).toHaveLength(3);
  });

  it('delete removes the object from where it is now, not where this replica last saw it', async () => {
    const { r2, provider, move } = build();
    await provider.exists(KEY);
    move();

    await expect(provider.delete(KEY)).resolves.toBe(true);

    expect(r2.sent('DeleteObjectCommand').map((c) => c.bucket)).toEqual([
      PRIVATE,
    ]);
    expect(r2.has(PRIVATE, KEY)).toBe(false);
  });

  it('forgetReadBucket makes the next read look again', async () => {
    const { r2, provider, cache, move } = build();
    await provider.exists(KEY);
    move();
    provider.forgetReadBucket(KEY);
    expect(cache().has(KEY)).toBe(false);

    await expect(provider.exists(KEY)).resolves.toBe(true);
    expect(cache().get(KEY)?.bucket).toBe(PRIVATE);
    expect(r2.sent('HeadObjectCommand').at(-1)?.bucket).toBe(PRIVATE);
  });

  it('believes a legacy location for seconds, not minutes', async () => {
    const { provider, cache } = build();
    await provider.exists(KEY);

    const ttl = (cache().get(KEY)?.expiresAt ?? 0) - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it('keeps the long memory for a key that is where it belongs', async () => {
    const { r2, provider, cache } = build();
    r2.put(PRIVATE, 'chat/fresh.webp', 'b');
    r2.put(MAIN, 'posts/a.webp', 'b');
    await provider.exists('chat/fresh.webp');
    await provider.exists('posts/a.webp');

    for (const key of ['chat/fresh.webp', 'posts/a.webp']) {
      const ttl = (cache().get(key)?.expiresAt ?? 0) - Date.now();
      expect(ttl).toBeGreaterThan(5 * 60 * 1000);
    }
  });
});

describe('CloudflareR2Provider.getRelocationTarget', () => {
  const build = (fields: object) => {
    const r2 = new FakeR2();
    const provider = Object.create(
      CloudflareR2Provider.prototype,
    ) as CloudflareR2Provider;
    Object.assign(provider, { isConfigured: true, s3: r2.client(), ...fields });
    return { provider, r2 };
  };

  it('names the client and both buckets', () => {
    const { provider } = build({
      bucketName: 'main',
      verificationBucketName: 'private',
    });
    const target = provider.getRelocationTarget();
    expect(target).toMatchObject({
      mainBucket: 'main',
      privateBucket: 'private',
    });
    expect(target?.s3).toBeDefined();
  });

  it('is null when both are the same bucket', () => {
    const { provider } = build({
      bucketName: 'main',
      verificationBucketName: 'main',
    });
    expect(provider.getRelocationTarget()).toBeNull();
  });

  it('is null without credentials', () => {
    const { provider } = build({
      bucketName: 'main',
      verificationBucketName: 'private',
      isConfigured: false,
      s3: null,
    });
    expect(provider.getRelocationTarget()).toBeNull();
  });
});
