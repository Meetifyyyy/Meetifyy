import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { StorageService, COLLEGE_LOGO_MAX_BYTES } from './uploads.service';
import type { StorageProvider } from './providers/storage-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../common/testing/stub';

/**
 * College logos from the Super Admin console: owner-less, public, PNG / JPEG /
 * WEBP only, ≤ 2 MB, bytes matching the declared type. SVG is refused because
 * `/api/media/*` serves from the API's own origin with no sanitizer.
 */
describe('StorageService.uploadCollegeLogo', () => {
  /** A real encoded image, `w` x `h`, optionally translucent. */
  const image = (
    w: number,
    h: number,
    format: 'png' | 'jpeg' | 'webp' = 'png',
    alpha = 1,
  ): Promise<Buffer> =>
    sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { r: 200, g: 30, b: 30, alpha },
      },
    })
      .toFormat(format)
      .toBuffer();

  let upload: jest.Mock<Promise<void>, [string, Buffer, string]>;
  let create: jest.Mock;
  let service: StorageService;

  beforeEach(() => {
    upload = jest.fn((_key: string, _buf: Buffer, _type: string) =>
      Promise.resolve(),
    );
    create = jest.fn(() => Promise.resolve({ id: 'media-1' }));
    service = new StorageService(
      stub<StorageProvider>({ upload }),
      stub<PrismaService>({ media: { create } }),
      stub<ConfigService>({}),
    );
  });

  const file = (mimetype: string, buffer: Buffer, size = buffer.length) =>
    stub<Express.Multer.File>({ mimetype, buffer, size, originalname: 'x' });

  it('stores a square PNG as a 512px WebP, public and owner-less', async () => {
    const res = await service.uploadCollegeLogo(
      file('image/png', await image(900, 900)),
    );
    expect(res.key).toMatch(/^colleges\/[0-9a-f]{32}\.webp$/);
    expect(res.mediaId).toBe('media-1');
    const stored = upload.mock.calls[0][1];
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.exif).toBeUndefined();
    expect(upload.mock.calls[0][2]).toBe('image/webp');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: null,
        visibility: 'public',
        mimeType: 'image/webp',
        fileSize: stored.length,
      }) as unknown,
    });
  });

  it('does not enlarge a small square logo', async () => {
    await service.uploadCollegeLogo(
      file('image/jpeg', await image(256, 256, 'jpeg')),
    );
    const meta = await sharp(upload.mock.calls[0][1]).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });

  it('keeps transparency', async () => {
    await service.uploadCollegeLogo(
      file('image/webp', await image(300, 300, 'webp', 0.4)),
    );
    const { data, info } = await sharp(upload.mock.calls[0][1])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[3]).toBeLessThan(255);
  });

  it('refuses a non-square image', async () => {
    await expect(
      service.uploadCollegeLogo(file('image/png', await image(600, 400))),
    ).rejects.toThrow(/square \(1:1\).*600x400/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses an image that is too small', async () => {
    await expect(
      service.uploadCollegeLogo(file('image/png', await image(32, 32))),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses bytes with a valid signature that do not decode', async () => {
    const truncated = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    await expect(
      service.uploadCollegeLogo(file('image/png', truncated)),
    ).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses SVG', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(
      service.uploadCollegeLogo(file('image/svg+xml', svg)),
    ).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a file over 2 MB', async () => {
    await expect(
      service.uploadCollegeLogo(
        file('image/png', await image(512, 512), COLLEGE_LOGO_MAX_BYTES + 1),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses bytes that do not match the declared type', async () => {
    await expect(
      service.uploadCollegeLogo(file('image/jpeg', await image(512, 512))),
    ).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });
});
