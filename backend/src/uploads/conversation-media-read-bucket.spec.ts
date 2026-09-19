import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';

/**
 * Where a conversation attachment is READ from.
 *
 * Moving `chat/`, `messages/` and `voice/` to the private bucket changed where
 * new objects are written and said nothing about the ones already written.
 * Every existing attachment is in the main bucket, so every read went to the
 * private bucket, missed, and reported the object as gone — and
 * `/api/media/chat/...` answered 404 for every attachment in the product,
 * AFTER passing its authorization check, which is what made it look like a
 * permissions bug rather than a storage one.
 */
describe('conversation media: which bucket a read goes to', () => {
  const MAIN = 'meetifyy-media';
  const PRIVATE = 'meetifyy-verification';

  /** Builds a provider whose S3 client only "has" the given keys per bucket. */
  const build = (objects: Record<string, string[]>) => {
    const heads: Array<{ Bucket: string; Key: string }> = [];
    const provider: any = Object.create(CloudflareR2Provider.prototype);
    provider.bucketName = MAIN;
    provider.verificationBucketName = PRIVATE;
    provider.publicUrl = 'https://pub-test.r2.dev';
    provider.isConfigured = true;
    provider.readBucketCache = new Map();
    provider.s3 = {
      send: async (cmd: any) => {
        const { Bucket, Key } = cmd.input;
        heads.push({ Bucket, Key });
        if ((objects[Bucket] || []).includes(Key)) return {};
        const err: any = new Error('NotFound');
        err.name = 'NotFound';
        throw err;
      },
    };
    return { provider, heads };
  };

  it('finds an attachment written before the move, in the main bucket', async () => {
    const key = 'chat/legacy.mp4';
    const { provider, heads } = build({ [MAIN]: [key], [PRIVATE]: [] });

    await expect(provider.exists(key)).resolves.toBe(true);
    // Private bucket first — that is where it would be written today — then
    // the main one, which is where it actually is.
    expect(heads.map((h) => h.Bucket)).toEqual([PRIVATE, MAIN]);
  });

  it('finds an attachment written after the move, in the private bucket', async () => {
    const key = 'chat/fresh.webp';
    const { provider, heads } = build({ [MAIN]: [], [PRIVATE]: [key] });

    await expect(provider.exists(key)).resolves.toBe(true);
    // Found on the first try, so the main bucket is never consulted.
    expect(heads.map((h) => h.Bucket)).toEqual([PRIVATE]);
  });

  it('reports a genuine miss as a miss', async () => {
    const { provider } = build({ [MAIN]: [], [PRIVATE]: [] });
    await expect(provider.exists('chat/gone.webp')).resolves.toBe(false);
  });

  it('does not go looking in the private bucket for ordinary public media', async () => {
    const key = 'posts/abc.webp';
    const { provider, heads } = build({ [MAIN]: [key], [PRIVATE]: [] });

    await expect(provider.exists(key)).resolves.toBe(true);
    expect(heads.map((h) => h.Bucket)).toEqual([MAIN]);
  });

  it('remembers where it found something, so a thread does not re-probe per image', async () => {
    const key = 'chat/legacy.mp4';
    const { provider, heads } = build({ [MAIN]: [key], [PRIVATE]: [] });

    await provider.exists(key);
    await provider.exists(key);
    await provider.exists(key);

    // Two lookups for the first call, nothing for the rest.
    expect(heads).toHaveLength(2);
  });

  it('deletes from the bucket the object is actually in', async () => {
    // Deleting from the bucket it would be WRITTEN to reported success while
    // leaving the object — and its public URL — exactly where it was.
    const key = 'chat/legacy.mp4';
    const { provider } = build({ [MAIN]: [key], [PRIVATE]: [] });
    const deletes: string[] = [];
    const head = provider.s3.send;
    provider.s3.send = async (cmd: any) => {
      if (cmd.constructor.name === 'DeleteObjectCommand') {
        deletes.push(cmd.input.Bucket);
        return {};
      }
      return head(cmd);
    };
    provider.getLocalFilePath = () => '/nonexistent/path';

    await provider.delete(key);
    expect(deletes).toEqual([MAIN]);
  });
});

/**
 * A private-prefixed key has no public URL and must not be handed one.
 *
 * `getPublicUrl` returned the main bucket's public host for every key,
 * including the ones routed to a bucket that host does not serve — so a
 * conversation attachment was advertised at an address where it does not
 * exist.
 */
describe('conversation media: the URL a key is advertised at', () => {
  const build = () => {
    const provider: any = Object.create(CloudflareR2Provider.prototype);
    provider.bucketName = 'meetifyy-media';
    provider.verificationBucketName = 'meetifyy-verification';
    provider.publicUrl = 'https://pub-test.r2.dev';
    provider.isConfigured = true;
    return provider;
  };

  it.each(['chat/a.webp', 'messages/a.webp', 'voice/a.ogg', 'verification/a.webp'])(
    'gives %s the authorizing API path, never the public host',
    (key) => {
      expect(build().getPublicUrl(key)).toBe(`/api/media/${key}`);
    },
  );

  it.each(['posts/a.webp', 'avatars/a.webp'])(
    'still gives %s the public host',
    (key) => {
      expect(build().getPublicUrl(key)).toBe(`https://pub-test.r2.dev/${key}`);
    },
  );
});
