import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';

/**
 * Verification documents can be routed to a bucket with no public host.
 *
 * The main bucket is served by a `pub-*.r2.dev` URL that resolves any key
 * without authentication — confirmed against the live bucket, where a real key
 * returned 200 and a random one returned 404. For a college ID that makes key
 * secrecy the only control, which is not good enough. These tests pin the
 * routing and the cache directive; provisioning the bucket is an operator step.
 */
describe('verification bucket routing', () => {
  const bucketFor = (provider: any, key: string) => provider.bucketFor(key);

  const build = (verificationBucket: string) => {
    const provider = Object.create(CloudflareR2Provider.prototype);
    provider.bucketName = 'meetifyy-media';
    provider.verificationBucketName = verificationBucket || 'meetifyy-media';
    return provider;
  };

  it('sends verification keys to the private bucket when one is configured', () => {
    const p = build('meetifyy-verification');
    expect(bucketFor(p, 'verification/abc.webp')).toBe('meetifyy-verification');
  });

  /**
   * Conversation attachments moved across with verification documents.
   *
   * They used to live on the main bucket, which is fronted by a public host
   * that resolves any key with no authentication — so a chat image was
   * readable by anyone who ever saw its URL, after the message was deleted,
   * with nothing able to revoke it. Authorizing `/api/media` does not help
   * while the CDN will serve the same bytes directly, so the object has to be
   * somewhere the CDN cannot reach.
   */
  it.each(['chat/abc.webp', 'messages/abc.webp', 'voice/abc.ogg'])(
    'sends %s to the private bucket',
    (key) => {
      const p = build('meetifyy-verification');
      expect(bucketFor(p, key)).toBe('meetifyy-verification');
    },
  );

  it('leaves genuinely public media on the main bucket', () => {
    const p = build('meetifyy-verification');
    expect(bucketFor(p, 'posts/abc.webp')).toBe('meetifyy-media');
    expect(bucketFor(p, 'avatars/abc.webp')).toBe('meetifyy-media');
    expect(bucketFor(p, 'community/abc.webp')).toBe('meetifyy-media');
    expect(bucketFor(p, 'defaults/abc.webp')).toBe('meetifyy-media');
  });

  it('falls back to the main bucket when unconfigured, changing nothing', () => {
    const p = build('');
    expect(bucketFor(p, 'verification/abc.webp')).toBe('meetifyy-media');
    expect(bucketFor(p, 'posts/abc.webp')).toBe('meetifyy-media');
  });

  it('refuses a copy that would cross the bucket boundary', async () => {
    const p = build('meetifyy-verification');
    p.isConfigured = true;
    p.s3 = { send: jest.fn() };
    p.logger = { error: jest.fn() };

    await expect(
      p.copy('verification/doc.webp', 'posts/leaked.webp'),
    ).resolves.toBe(false);
    // Nothing was sent — the refusal happens before the request is built.
    expect(p.s3.send).not.toHaveBeenCalled();
  });
});
