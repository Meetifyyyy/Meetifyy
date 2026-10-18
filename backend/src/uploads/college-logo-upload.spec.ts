import { BadRequestException } from '@nestjs/common';
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
  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  let upload: jest.Mock;
  let create: jest.Mock;
  let service: StorageService;

  beforeEach(() => {
    upload = jest.fn(() => Promise.resolve());
    create = jest.fn(() => Promise.resolve({ id: 'media-1' }));
    service = new StorageService(
      stub<StorageProvider>({ upload }),
      stub<PrismaService>({ media: { create } }),
      stub<ConfigService>({}),
    );
  });

  const file = (mimetype: string, buffer: Buffer, size = buffer.length) =>
    stub<Express.Multer.File>({ mimetype, buffer, size, originalname: 'x' });

  it('stores a PNG under colleges/, public and owner-less', async () => {
    const res = await service.uploadCollegeLogo(file('image/png', PNG));
    expect(res.key).toMatch(/^colleges\/[0-9a-f]{32}\.png$/);
    expect(res.mediaId).toBe('media-1');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: null,
        visibility: 'public',
        mimeType: 'image/png',
      }) as unknown,
    });
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
        file('image/png', PNG, COLLEGE_LOGO_MAX_BYTES + 1),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses bytes that do not match the declared type', async () => {
    await expect(
      service.uploadCollegeLogo(file('image/jpeg', PNG)),
    ).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });
});
