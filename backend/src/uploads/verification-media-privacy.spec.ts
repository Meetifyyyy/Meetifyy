import type { ConfigService } from '@nestjs/config';
import { StorageService } from './uploads.service';
import { stub } from '../common/testing/stub';
import { MP4_BYTES } from './testing/media-bytes';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';

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
  let prisma: { media: { findUnique: jest.Mock } };
  let service: StorageService;

  beforeEach(() => {
    prisma = { media: { findUnique: jest.fn() } };
    service = new StorageService(
      stub<StorageProvider>({
        getPublicUrl: (k: string) => `https://cdn.example/${k}`,
      }),
      stub<PrismaService>(prisma),
      stub<ConfigService>({ get: jest.fn(() => undefined) }),
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
 * Identity documents have exactly one way in: the verification capture, which
 * decodes and re-encodes the image, enforces the account's verification state
 * and writes the `verification/live-*` key a submission checks. The generic
 * upload used to accept `folder=verification` after only a byte sniff, which
 * stored a document under the same prefix that skipped all of that.
 */
describe('generic upload and the verification folder', () => {
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
  let rowsCreated: number;

  const file = (mimetype: string, buffer: Buffer) =>
    stub<Express.Multer.File>({ mimetype, buffer, size: buffer.length });

  beforeEach(() => {
    uploaded = [];
    rowsCreated = 0;
    service = new StorageService(
      stub<StorageProvider>({
        upload: jest.fn((k: string) => {
          uploaded.push(k);

          return Promise.resolve();
        }),
        getPublicUrl: (k: string) => `https://cdn.example/${k}`,
      }),
      stub<PrismaService>({
        media: {
          create: jest.fn(({ data }: { data: object }) => {
            rowsCreated += 1;
            return Promise.resolve({ id: 'm1', ...data });
          }),
        },
      }),
      stub<ConfigService>({ get: jest.fn(() => undefined) }),
    );
  });

  it('refuses folder=verification even for a genuine image', async () => {
    await expect(
      service.uploadFile('u1', file('image/jpeg', jpegBytes), 'verification'),
    ).rejects.toThrow(/verification flow/);
    // Nothing reached storage and no row was registered.
    expect(uploaded).toHaveLength(0);
    expect(rowsCreated).toBe(0);
  });

  it('refuses it with a variant key too, which would otherwise pick the object name', async () => {
    await expect(
      service.uploadFile(
        'u1',
        file('image/jpeg', jpegBytes),
        'verification',
        'verification/live-selfie-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_thumb.webp',
      ),
    ).rejects.toThrow(/verification flow/);
    expect(uploaded).toHaveLength(0);
  });

  it('leaves the ordinary upload paths alone', async () => {
    // Post and chat uploads accept video and audio, which the image-only
    // verification check must not be applied to.
    const result = await service.uploadFile(
      'u1',
      file('video/mp4', MP4_BYTES),
      'posts',
    );
    expect(uploaded).toHaveLength(1);
    expect(result.media.visibility).toBe('public');
  });

  it('refuses a post or chat upload whose bytes are not the kind it claims', async () => {
    await expect(
      service.uploadFile('u1', file('video/mp4', notAnImage), 'posts'),
    ).rejects.toThrow(/do not match its type/);
    await expect(
      service.uploadFile('u1', file('image/png', MP4_BYTES), 'chat'),
    ).rejects.toThrow(/do not match its type/);
    expect(uploaded).toHaveLength(0);
  });

  it('does not sniff voice notes, whose containers share no signature', async () => {
    await service.uploadFile('u1', file('audio/webm', notAnImage), 'voice');
    expect(uploaded).toHaveLength(1);
  });

  it('refuses a presigned direct upload into the verification folder', async () => {
    // A presigned PUT never passes the server, so the bytes could not be
    // checked and the recorded type would be the client's claim.
    await expect(
      service.getPresignedUrl(
        'u1',
        'id.jpg',
        'image/jpeg',
        'verification',
        1000,
      ),
    ).rejects.toThrow(/verification flow/);
  });
});
