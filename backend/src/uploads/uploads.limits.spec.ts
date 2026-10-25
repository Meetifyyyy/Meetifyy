import type { ConfigService } from '@nestjs/config';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { StorageService } from './uploads.service';
import { MP4_BYTES, WEBP_BYTES } from './testing/media-bytes';
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
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    storageService = new StorageService(
      stub<StorageProvider>(mockStorageProvider),
      stub<PrismaService>(mockPrisma),
      stub<ConfigService>(mockConfig),
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
        } catch (err: unknown) {
          expect((err as Error).message).toBe(COVERED_IMAGE_SIZE_ERROR_MESSAGE);
        }
      },
    );

    /*
     * Messages: 15 MB a video, 5 MB an image. Posts: 25 MB a video, 5 MB an
     * image. Each file on its own; exactly at the limit is allowed.
     */
    const MB = 1024 * 1024;
    const perFile: Array<[string, string, string, number]> = [
      ['chat', 'video/mp4', 'Video must be 15 MB or less', 15 * MB],
      ['chat', 'image/webp', 'Image must be 5 MB or less', 5 * MB],
      ['posts', 'video/mp4', 'Video must be 25 MB or less', 25 * MB],
      ['posts', 'image/webp', 'Image must be 5 MB or less', 5 * MB],
    ];

    it.each(perFile)(
      'accepts a %s %s at exactly its limit',
      async (folder, type, _message, limit) => {
        const result = await storageService.getPresignedUrl(
          'user-1',
          'file',
          type,
          folder,
          limit,
        );
        expect(result.mediaId).toBe('media-123');
      },
    );

    it.each(perFile)(
      'refuses a %s %s one byte over its limit with a 413',
      async (folder, type, message, limit) => {
        const attempt = storageService.getPresignedUrl(
          'user-1',
          'file',
          type,
          folder,
          limit + 1,
        );
        await expect(attempt).rejects.toBeInstanceOf(PayloadTooLargeException);
        await expect(attempt).rejects.toThrow(message);
        expect(
          mockStorageProvider.createSignedUploadUrl,
        ).not.toHaveBeenCalled();
      },
    );

    it('holds a voice note to 15 MB', async () => {
      await expect(
        storageService.getPresignedUrl(
          'user-1',
          'note.webm',
          'audio/webm',
          'voice',
          15 * MB,
        ),
      ).resolves.toBeDefined();
      const over = storageService.getPresignedUrl(
        'user-1',
        'note.webm',
        'audio/webm',
        'voice',
        15 * MB + 1,
      );
      await expect(over).rejects.toBeInstanceOf(PayloadTooLargeException);
      await expect(over).rejects.toThrow('Voice note must be 15 MB or less');
    });

    it("accepts the recorder's own type, codec parameter and all, and signs it as sent", async () => {
      await storageService.getPresignedUrl(
        'user-1',
        'note.webm',
        'audio/webm;codecs=opus',
        'voice',
        1000,
      );
      expect(mockStorageProvider.createSignedUploadUrl).toHaveBeenCalledWith(
        'note.webm',
        'audio/webm;codecs=opus',
        'voice',
        undefined,
        undefined,
        1000,
      );
      // Recorded as the essence.
      expect(mockPrisma.media.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ mimeType: 'audio/webm' }) as unknown,
      });
    });

    it("accepts Safari's AAC voice notes", async () => {
      await expect(
        storageService.getPresignedUrl(
          'user-1',
          'note.m4a',
          'audio/mp4',
          'voice',
          1000,
        ),
      ).resolves.toBeDefined();
    });

    it('refuses a type with junk parameters', async () => {
      await expect(
        storageService.getPresignedUrl(
          'user-1',
          'x',
          'audio/webm;<script>',
          'voice',
          1000,
        ),
      ).rejects.toThrow('Unsupported content type');
    });

    it('refuses an empty file', async () => {
      await expect(
        storageService.getPresignedUrl(
          'user-1',
          'v.mp4',
          'video/mp4',
          'chat',
          0,
        ),
      ).rejects.toThrow('This file is empty');
    });

    it('binds the checked size into the signed URL', async () => {
      await storageService.getPresignedUrl(
        'user-1',
        'v.mp4',
        'video/mp4',
        'chat',
        12345,
      );
      expect(mockStorageProvider.createSignedUploadUrl).toHaveBeenCalledWith(
        'v.mp4',
        'video/mp4',
        'chat',
        undefined,
        undefined,
        12345,
      );
    });
  });

  describe('uploadFile pass-through per-file limits', () => {
    const MB = 1024 * 1024;
    const upload = (folder: string, mimetype: string, size: number) =>
      storageService.uploadFile(
        'user-1',
        stub<Express.Multer.File>({
          buffer: mimetype.startsWith('video/') ? MP4_BYTES : WEBP_BYTES,
          mimetype,
          size,
        }),
        folder,
      );

    it('stores a chat video at exactly 15 MB', async () => {
      await expect(upload('chat', 'video/mp4', 15 * MB)).resolves.toBeDefined();
      expect(mockStorageProvider.upload).toHaveBeenCalled();
    });

    it('refuses a chat video over 15 MB before storing anything', async () => {
      await expect(upload('chat', 'video/mp4', 15 * MB + 1)).rejects.toThrow(
        'Video must be 15 MB or less',
      );
      await expect(upload('posts', 'image/webp', 5 * MB + 1)).rejects.toThrow(
        'Image must be 5 MB or less',
      );
      expect(mockStorageProvider.upload).not.toHaveBeenCalled();
    });

    it('stores a post video up to 25 MB', async () => {
      await expect(
        upload('posts', 'video/mp4', 25 * MB),
      ).resolves.toBeDefined();
    });

    it('refuses an empty file', async () => {
      await expect(upload('chat', 'image/webp', 0)).rejects.toThrow(
        'This file is empty',
      );
    });
  });

  describe('confirmUpload measures what storage holds', () => {
    const MB = 1024 * 1024;
    const row = {
      id: 'm1',
      ownerId: 'user-1',
      mimeType: 'video/mp4',
      fileSize: 1,
    };

    it('deletes and refuses an object over its limit', async () => {
      mockPrisma.media.findUnique.mockResolvedValueOnce(row);
      mockStorageProvider.getMetadata.mockResolvedValueOnce({
        contentLength: 15 * MB + 1,
        contentType: 'video/mp4',
      });
      await expect(
        storageService.confirmUpload('chat/abc.mp4', 'user-1'),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('chat/abc.mp4');
      expect(mockPrisma.media.deleteMany).toHaveBeenCalledWith({
        where: { objectKey: 'chat/abc.mp4', ownerId: 'user-1', postId: null },
      });
    });

    it('keeps an object within its limit', async () => {
      mockPrisma.media.findUnique.mockResolvedValueOnce(row);
      mockStorageProvider.getMetadata.mockResolvedValueOnce({
        contentLength: 15 * MB,
        contentType: 'video/mp4',
      });
      await expect(
        storageService.confirmUpload('chat/abc.mp4', 'user-1'),
      ).resolves.toEqual(row);
      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
    });

    it('does not delete on a miss, which can be storage lagging the PUT', async () => {
      mockPrisma.media.findUnique.mockResolvedValueOnce(row);
      mockStorageProvider.getMetadata.mockResolvedValueOnce(null);
      await expect(
        storageService.confirmUpload('chat/abc.mp4', 'user-1'),
      ).resolves.toEqual(row);
      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
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
