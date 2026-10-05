import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Media } from '@prisma/client';
import { StorageService } from './uploads.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';

/**
 * A thumbnail key is chosen by the client, so it must not be a way to write
 * somebody else's thumbnail. Before this rule, any signed-in user could presign
 * `posts/<anyone's image>_thumb.webp` and replace what every feed shows for that
 * post — and the row upsert handed them ownership of it.
 */
describe('thumbnail variant keys', () => {
  type Row = Pick<Media, 'objectKey' | 'ownerId'>;
  let rows: Row[];
  let service: StorageService;
  let provider: {
    createSignedUploadUrl: jest.Mock;
    upload: jest.Mock;
  };
  let upsert: jest.Mock;

  beforeEach(() => {
    rows = [
      { objectKey: 'posts/mine.webp', ownerId: 'me' },
      { objectKey: 'posts/theirs.webp', ownerId: 'them' },
      { objectKey: 'posts/taken_thumb.webp', ownerId: 'them' },
      { objectKey: 'posts/taken.webp', ownerId: 'me' },
    ];
    provider = {
      createSignedUploadUrl: jest.fn(
        (_f: string, _c: string, _folder: string, _e: unknown, key: string) =>
          Promise.resolve({ uploadUrl: 'https://r2/put', publicUrl: '', key }),
      ),
      upload: jest.fn(() => Promise.resolve()),
    };
    upsert = jest.fn(({ create }: { create: Row }) =>
      Promise.resolve({ id: 'm1', ...create }),
    );
    const prisma = stub<PrismaService>({
      media: {
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: { objectKey: { in: string[] }; ownerId: string };
          }) =>
            Promise.resolve(
              rows.find(
                (r) =>
                  where.objectKey.in.includes(r.objectKey) &&
                  r.ownerId === where.ownerId,
              ) ?? null,
            ),
        ),
        findUnique: jest.fn(({ where }: { where: { objectKey: string } }) =>
          Promise.resolve(
            rows.find((r) => r.objectKey === where.objectKey) ?? null,
          ),
        ),
        upsert,
        create: jest.fn(({ data }: { data: Row }) =>
          Promise.resolve({ id: 'm2', ...data }),
        ),
      },
    });
    service = new StorageService(
      stub<StorageProvider>(provider),
      prisma,
      stub<ConfigService>({ get: jest.fn(() => undefined) }),
    );
  });

  const presign = (userId: string, variantKey: string) =>
    service.getPresignedUrl(
      userId,
      'thumb.webp',
      'image/webp',
      'posts',
      1000,
      variantKey,
    );

  const file = stub<Express.Multer.File>({
    buffer: Buffer.from('x'),
    mimetype: 'image/webp',
    size: 1,
  });

  it('lets the owner of the original presign its thumbnail', async () => {
    const res = await presign('me', 'posts/mine_thumb.webp');
    expect(res.key).toBe('posts/mine_thumb.webp');
  });

  it("refuses a thumbnail for somebody else's original", async () => {
    await expect(
      presign('me', 'posts/theirs_thumb.webp'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a thumbnail row somebody else owns', async () => {
    await expect(
      presign('me', 'posts/taken_thumb.webp'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a thumbnail whose original does not exist', async () => {
    await expect(
      presign('me', 'posts/ghost_thumb.webp'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a pass-through thumbnail at its derived key, not a random one', async () => {
    const res = await service.uploadFile(
      'me',
      file,
      'posts',
      'posts/mine_thumb.webp',
    );
    expect(res.key).toBe('posts/mine_thumb.webp');
    expect(provider.upload).toHaveBeenCalledWith(
      'posts/mine_thumb.webp',
      expect.any(Buffer),
      'image/webp',
    );
    expect(upsert).toHaveBeenCalled();
  });

  it('applies the same ownership rule to the pass-through', async () => {
    await expect(
      service.uploadFile('me', file, 'posts', 'posts/theirs_thumb.webp'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.upload).not.toHaveBeenCalled();
  });
});
