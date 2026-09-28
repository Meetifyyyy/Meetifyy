import type { ConfigService } from '@nestjs/config';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import type { StorageProvider } from './providers/storage-provider.interface';
import { StorageService } from './uploads.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The size and type the database records for an upload must be what storage
 * actually holds, not what the client declared.
 *
 * `confirmUpload` re-reads the object after the client's PUT and corrects the
 * Media row. That correction read `contentLength` / `contentType`, while the R2
 * provider handed back S3's raw `HeadObjectCommandOutput` — `ContentLength` /
 * `ContentType`. The condition was never true on R2, so every row kept the
 * client's declared size and type (pending item A14). These pin the provider
 * to the normalised shape the caller reads.
 */
describe('CloudflareR2Provider.getMetadata', () => {
  const build = (head: object | Error) => {
    const provider = Object.create(
      CloudflareR2Provider.prototype,
    ) as CloudflareR2Provider;
    Object.assign(provider, {
      bucketName: 'meetifyy-media',
      verificationBucketName: 'meetifyy-media',
      isConfigured: true,
      readBucketCache: new Map(),
      s3: {
        send: jest.fn(() =>
          head instanceof Error ? Promise.reject(head) : Promise.resolve(head),
        ),
      },
    });
    return provider;
  };

  it('reports the stored size and type in the shape confirmUpload reads', async () => {
    const provider = build({
      ContentLength: 48_213,
      ContentType: 'image/webp',
      ETag: '"abc"',
    });

    await expect(
      provider.getMetadata('posts/does-not-exist-locally.webp'),
    ).resolves.toEqual({ contentLength: 48_213, contentType: 'image/webp' });
  });

  it('reports nothing for an object storage cannot find', async () => {
    const provider = build(new Error('NotFound'));

    await expect(
      provider.getMetadata('posts/does-not-exist-locally.webp'),
    ).resolves.toBeNull();
  });
});

describe('StorageService.confirmUpload — metadata correction', () => {
  const KEY = 'posts/0123456789abcdef0123456789abcdef.webp';
  const settle = () => new Promise((r) => setImmediate(r));

  const build = (
    metadata: { contentLength?: number; contentType?: string } | null,
  ) => {
    const update = jest.fn(() => Promise.resolve({}));
    const service = new StorageService(
      stub<StorageProvider>({
        exists: jest.fn(() => Promise.resolve(true)),
        getMetadata: jest.fn(() => Promise.resolve(metadata)),
      }),
      stub<PrismaService>({
        media: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              id: 'm1',
              ownerId: 'u1',
              objectKey: KEY,
              fileSize: 999_999,
              mimeType: 'image/png',
            }),
          ),
          update,
        },
      }),
      stub<ConfigService>({ get: jest.fn(() => undefined) }),
    );
    return { service, update };
  };

  it('replaces the declared size and type with what storage holds', async () => {
    const { service, update } = build({
      contentLength: 48_213,
      contentType: 'image/webp',
    });

    await service.confirmUpload(KEY, 'u1');
    await settle();

    expect(update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { fileSize: 48_213, mimeType: 'image/webp' },
    });
  });

  it('leaves the row alone when storage has nothing to report', async () => {
    const { service, update } = build(null);

    await service.confirmUpload(KEY, 'u1');
    await settle();

    expect(update).not.toHaveBeenCalled();
  });
});
