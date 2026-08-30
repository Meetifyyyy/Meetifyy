import { StorageService } from './uploads.service';

/**
 * Verification documents — a live selfie and a government/college ID — must
 * never be reachable through `GET /api/media/*`.
 *
 * That endpoint is unauthenticated by design: every URL under it is consumed
 * as a plain `<img src>` from a different origin. It previously resolved ANY
 * storage key to a public URL and 302'd to it, with `Cache-Control: public`.
 * The `Media.visibility` column existed and was set to 'private' on
 * submission, but nothing anywhere read it, so it protected nothing — and it
 * was written only *after* upload, leaving the document public in the gap and
 * permanently public if the user abandoned the form.
 *
 * These tests pin both halves of the fix: the folder is a hard floor that does
 * not depend on any column, and `visibility` is now actually honoured.
 */
describe('verification media privacy', () => {
  let prisma: any;
  let service: StorageService;

  beforeEach(() => {
    prisma = { media: { findUnique: jest.fn() } };
    service = new StorageService(
      { getPublicUrl: (k: string) => `https://cdn.example/${k}` } as any,
      prisma,
      { get: () => undefined } as any,
    );
  });

  it('never resolves a verification key to a public URL', async () => {
    // Even with a row that claims to be public — the folder wins.
    prisma.media.findUnique.mockResolvedValue({
      provider: 'r2',
      bucket: 'b',
      objectKey: 'verification/abc.jpg',
      visibility: 'public',
    });
    await expect(
      service.getResolvedPublicUrl('verification/abc.jpg'),
    ).resolves.toBeNull();
  });

  it('never resolves a verification key that has no media row at all', async () => {
    // The pre-fix code fell through to `getPublicUrl(key)` for unregistered
    // keys, so a document whose row was missing was served regardless.
    prisma.media.findUnique.mockResolvedValue(null);
    await expect(
      service.getResolvedPublicUrl('verification/orphan.jpg'),
    ).resolves.toBeNull();
  });

  it('honours visibility for private media outside the verification folder', async () => {
    prisma.media.findUnique.mockResolvedValue({
      provider: 'r2',
      bucket: 'b',
      objectKey: 'posts/secret.jpg',
      visibility: 'private',
    });
    await expect(
      service.getResolvedPublicUrl('posts/secret.jpg'),
    ).resolves.toBeNull();
  });

  it('still serves ordinary public media', async () => {
    prisma.media.findUnique.mockResolvedValue({
      provider: 'r2',
      bucket: 'b',
      objectKey: 'posts/cat.jpg',
      visibility: 'public',
    });
    await expect(service.getResolvedPublicUrl('posts/cat.jpg')).resolves.toBe(
      'https://cdn.example/posts/cat.jpg',
    );
  });

  it('classifies the verification folder as always-private', () => {
    expect(service.isAlwaysPrivateKey('verification/a.jpg')).toBe(true);
    expect(service.isAlwaysPrivateKey('posts/a.jpg')).toBe(false);
    // Guards the controller's short-circuit, which runs before the local-disk
    // branch — that branch streams bytes straight off disk and would otherwise
    // bypass URL resolution entirely.
    expect(service.isAlwaysPrivateKey('verification/nested/a.jpg')).toBe(true);
  });

  it('creates verification uploads private, rather than patching them later', () => {
    expect(service.visibilityForFolder('verification')).toBe('private');
    expect(service.visibilityForFolder('posts')).toBe('public');
    expect(service.visibilityForFolder('avatars')).toBe('public');
  });
});

/**
 * A verification document's declared type comes from the same untrusted
 * multipart body as its bytes. The submission check downstream trusts the
 * recorded mimetype, and a human reviewer makes an identity decision from the
 * rendered image, so the two have to actually agree.
 */
describe('verification upload content validation', () => {
  const jpegBytes = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(32),
  ]);
  const notAnImage = Buffer.concat([
    Buffer.from('this is plain text, not a jpeg'),
    Buffer.alloc(32),
  ]);

  let service: StorageService;
  let uploaded: string[];

  const file = (mimetype: string, buffer: Buffer) =>
    ({ mimetype, buffer, size: buffer.length }) as any;

  beforeEach(() => {
    uploaded = [];
    service = new StorageService(
      {
        upload: async (k: string) => {
          uploaded.push(k);
        },
        getPublicUrl: (k: string) => `https://cdn.example/${k}`,
      } as any,
      { media: { create: async ({ data }: any) => ({ id: 'm1', ...data }) } } as any,
      { get: () => undefined } as any,
    );
  });

  it('rejects bytes that do not match the declared image type', async () => {
    await expect(
      service.uploadFile('u1', file('image/jpeg', notAnImage), 'verification'),
    ).rejects.toThrow('do not match its type');
    // Nothing reached storage.
    expect(uploaded).toHaveLength(0);
  });

  it('rejects a non-image document outright', async () => {
    await expect(
      service.uploadFile('u1', file('video/mp4', jpegBytes), 'verification'),
    ).rejects.toThrow('must be images');
  });

  it('accepts a genuine image and stores it private', async () => {
    const result = await service.uploadFile(
      'u1',
      file('image/jpeg', jpegBytes),
      'verification',
    );
    expect(uploaded).toHaveLength(1);
    expect(result.media.visibility).toBe('private');
  });

  it('leaves the ordinary upload paths alone', async () => {
    // Post and chat uploads accept video and audio, whose signatures this
    // checker does not carry — sniffing them here would break them.
    const result = await service.uploadFile(
      'u1',
      file('video/mp4', notAnImage),
      'posts',
    );
    expect(uploaded).toHaveLength(1);
    expect(result.media.visibility).toBe('public');
  });
});
