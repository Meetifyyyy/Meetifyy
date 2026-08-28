import { BadRequestException } from '@nestjs/common';
import { StorageService } from './uploads.service';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  COVERED_IMAGE_FOLDERS,
  isCoveredImageFolder,
} from './uploads.constants';

describe('Upload Size Limits & Validation', () => {
  let storageService: StorageService;
  const mockStorageProvider = {
    upload: jest.fn().mockResolvedValue(undefined),
    createSignedUploadUrl: jest.fn().mockResolvedValue({
      uploadUrl: 'https://storage.example.com/upload',
      publicUrl: 'https://cdn.example.com/file.webp',
      key: 'avatars/random.webp',
    }),
    exists: jest.fn().mockResolvedValue(true),
    getPublicUrl: jest
      .fn()
      .mockReturnValue('https://cdn.example.com/file.webp'),
    createSignedUrls: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue(true),
    getMetadata: jest.fn().mockResolvedValue(null),
  };

  const mockPrisma = {
    media: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'media-123',
          ...data,
        }),
      ),
      upsert: jest.fn().mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'media-123',
          ...create,
        }),
      ),
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    storageService = new StorageService(
      mockStorageProvider as any,
      mockPrisma as any,
      mockConfig as any,
    );
  });

  describe('isCoveredImageFolder helper', () => {
    it.each(COVERED_IMAGE_FOLDERS)(
      'identifies %s as a covered image folder',
      (folder) => {
        expect(isCoveredImageFolder(folder)).toBe(true);
      },
    );

    it.each(['posts', 'chat', 'voice', 'temp', 'general', 'support'])(
      'does not treat excluded/general folder %s as a covered image folder',
      (folder) => {
        expect(isCoveredImageFolder(folder)).toBe(false);
      },
    );
  });

  describe('getPresignedUrl size validation', () => {
    it.each(COVERED_IMAGE_FOLDERS)(
      'accepts covered image upload at exactly 10 MB for folder "%s"',
      async (folder) => {
        const result = await storageService.getPresignedUrl(
          'user-1',
          'image.webp',
          'image/webp',
          folder,
          MAX_COVERED_IMAGE_SIZE_BYTES,
        );
        expect(result).toBeDefined();
        expect(result.mediaId).toBe('media-123');
      },
    );

    it.each(COVERED_IMAGE_FOLDERS)(
      'accepts covered image upload under 10 MB for folder "%s"',
      async (folder) => {
        const result = await storageService.getPresignedUrl(
          'user-1',
          'image.webp',
          'image/webp',
          folder,
          5 * 1024 * 1024,
        );
        expect(result).toBeDefined();
      },
    );

    it.each(COVERED_IMAGE_FOLDERS)(
      'rejects covered image upload exceeding 10 MB for folder "%s"',
      async (folder) => {
        const oversizedBytes = MAX_COVERED_IMAGE_SIZE_BYTES + 1;
        await expect(
          storageService.getPresignedUrl(
            'user-1',
            'image.webp',
            'image/webp',
            folder,
            oversizedBytes,
          ),
        ).rejects.toThrow(BadRequestException);

        try {
          await storageService.getPresignedUrl(
            'user-1',
            'image.webp',
            'image/webp',
            folder,
            oversizedBytes,
          );
        } catch (err: any) {
          expect(err.message).toBe(COVERED_IMAGE_SIZE_ERROR_MESSAGE);
        }
      },
    );

    it('preserves 50 MB limit for post uploads without rejecting 25 MB images', async () => {
      const result = await storageService.getPresignedUrl(
        'user-1',
        'post.webp',
        'image/webp',
        'posts',
        25 * 1024 * 1024,
      );
      expect(result).toBeDefined();
    });

    it('preserves 50 MB limit for chat media uploads without rejecting 20 MB images', async () => {
      const result = await storageService.getPresignedUrl(
        'user-1',
        'chat.webp',
        'image/webp',
        'chat',
        20 * 1024 * 1024,
      );
      expect(result).toBeDefined();
    });
  });

  describe('uploadFile pass-through size validation', () => {
    it('accepts covered image upload under 10 MB in uploadFile', async () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        mimetype: 'image/png',
        size: 5 * 1024 * 1024,
      } as Express.Multer.File;

      const res = await storageService.uploadFile(
        'user-1',
        mockFile,
        'avatars',
      );
      expect(res).toBeDefined();
      expect(mockStorageProvider.upload).toHaveBeenCalled();
    });

    it('rejects covered image upload exceeding 10 MB in uploadFile', async () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        mimetype: 'image/png',
        size: MAX_COVERED_IMAGE_SIZE_BYTES + 1024,
      } as Express.Multer.File;

      await expect(
        storageService.uploadFile('user-1', mockFile, 'avatars'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
