import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { VerificationMethod, VerificationStatus } from '@prisma/client';
import sharp from 'sharp';
import {
  LIVE_CAPTURE_LIMITS,
  VerificationService,
  type CaptureUpload,
} from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/uploads.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';

/**
 * The live verification flow: one camera capture, a selfie OR a government ID.
 * Images are real (made with sharp), so decoding, re-encoding and metadata
 * stripping are exercised rather than mocked away.
 */

const userId = 'user-1';
const HEX = 'a'.repeat(32);

const jpegOf = async (width: number, height: number, withExif = false) => {
  let image = sharp({
    create: { width, height, channels: 3, background: '#808080' },
  });
  if (withExif) {
    image = image.withExif({ IFD0: { Make: 'TestCam', Model: 'Leaky' } });
  }
  return image.jpeg().toBuffer();
};

const upload = (buffer: Buffer, mimetype = 'image/jpeg'): CaptureUpload => ({
  buffer,
  mimetype,
  size: buffer.length,
});

describe('VerificationService — live capture', () => {
  let service: VerificationService;

  const storeVerificationCapture = jest.fn(
    (
      _userId: string,
      kind: 'selfie' | 'id',
      jpeg: Buffer,
      width: number,
      height: number,
    ): Promise<{ mediaId: string; key: string }> => {
      void jpeg;
      void width;
      void height;
      return Promise.resolve({
        mediaId: 'media-1',
        key: `verification/live-${kind}-${HEX}.jpg`,
      });
    },
  );
  const mockStorage = { storeVerificationCapture, delete: jest.fn() };

  const mockPrisma = {
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    media: { findUnique: jest.fn(), updateMany: jest.fn() },
    verificationRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mockPrisma.$transaction.mockImplementation((arg: unknown) =>
    (arg as (tx: typeof mockPrisma) => unknown)(mockPrisma),
  );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        verificationAccessMockProvider(),
        VerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();
    service = module.get(VerificationService);
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      verificationStatus: VerificationStatus.UNVERIFIED,
    });
  });

  describe('captureDocument', () => {
    it('stores a re-encoded JPEG with no metadata', async () => {
      const input = await jpegOf(1280, 960, true);
      expect((await sharp(input).metadata()).exif).toBeDefined();

      await expect(
        service.captureDocument(userId, 'id', upload(input)),
      ).resolves.toEqual({ mediaId: 'media-1' });

      const [, kind, stored, width, height] =
        storeVerificationCapture.mock.calls[0];
      expect(kind).toBe('id');
      expect([width, height]).toEqual([1280, 960]);
      const meta = await sharp(stored).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
    });

    it('scales a large capture down to the stored size', async () => {
      await service.captureDocument(
        userId,
        'selfie',
        upload(await jpegOf(4000, 3000)),
      );
      const [, , , width, height] = storeVerificationCapture.mock.calls[0];
      expect(Math.max(width, height)).toBe(
        LIVE_CAPTURE_LIMITS.storedLongEdgePx,
      );
    });

    it('refuses bytes that do not match the declared type', async () => {
      const png = await sharp({
        create: { width: 800, height: 800, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer();
      await expect(
        service.captureDocument(userId, 'selfie', upload(png, 'image/jpeg')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storeVerificationCapture).not.toHaveBeenCalled();
    });

    it('refuses something that is not an image at all', async () => {
      const fake = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from('not really a jpeg, just the magic number'),
      ]);
      await expect(
        service.captureDocument(userId, 'id', upload(fake)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storeVerificationCapture).not.toHaveBeenCalled();
    });

    it('refuses a capture too small to review', async () => {
      await expect(
        service.captureDocument(userId, 'id', upload(await jpegOf(320, 240))),
      ).rejects.toThrow(/too small/);
    });

    it('refuses an empty upload', async () => {
      await expect(
        service.captureDocument(userId, 'selfie', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an account that cannot submit (already pending or verified)', async () => {
      for (const status of [
        VerificationStatus.PENDING,
        VerificationStatus.VERIFIED,
      ]) {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
          verificationStatus: status,
        });
        await expect(
          service.captureDocument(userId, 'id', upload(await jpegOf(800, 600))),
        ).rejects.toBeInstanceOf(ConflictException);
      }
      expect(storeVerificationCapture).not.toHaveBeenCalled();
    });
  });

  describe('submitLiveVerification', () => {
    const liveMedia = (
      kind: 'selfie' | 'id',
      overrides: Record<string, unknown> = {},
    ) => ({
      id: 'media-1',
      ownerId: userId,
      mimeType: 'image/jpeg',
      objectKey: `verification/live-${kind}-${HEX}.jpg`,
      createdAt: new Date(),
      ...overrides,
    });

    const allowSubmit = () => {
      mockPrisma.verificationRequest.count.mockResolvedValue(0);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.verificationRequest.findFirst.mockResolvedValue(null);
      mockPrisma.verificationRequest.create.mockResolvedValue({
        id: 'req-1',
        attemptNumber: 1,
      });
    };

    it('submits a government ID alone, with no selfie', async () => {
      mockPrisma.media.findUnique.mockResolvedValue(liveMedia('id'));
      allowSubmit();

      await service.submitLiveVerification(
        userId,
        VerificationMethod.LIVE_GOVERNMENT_ID,
        'media-1',
      );

      expect(mockPrisma.verificationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            method: VerificationMethod.LIVE_GOVERNMENT_ID,
            idCardMediaId: 'media-1',
            selfieMediaId: null,
          }) as unknown,
        }),
      );
    });

    it('submits a selfie alone, with no ID', async () => {
      mockPrisma.media.findUnique.mockResolvedValue(liveMedia('selfie'));
      allowSubmit();

      await service.submitLiveVerification(
        userId,
        VerificationMethod.LIVE_SELFIE,
        'media-1',
      );

      expect(mockPrisma.verificationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            method: VerificationMethod.LIVE_SELFIE,
            selfieMediaId: 'media-1',
            idCardMediaId: null,
          }) as unknown,
        }),
      );
    });

    it('refuses a generic upload that did not come from the live capture', async () => {
      mockPrisma.media.findUnique.mockResolvedValue(
        liveMedia('id', { objectKey: `verification/${HEX}.jpg` }),
      );
      allowSubmit();
      await expect(
        service.submitLiveVerification(
          userId,
          VerificationMethod.LIVE_GOVERNMENT_ID,
          'media-1',
        ),
      ).rejects.toThrow(/camera/);
      expect(mockPrisma.verificationRequest.create).not.toHaveBeenCalled();
    });

    it('refuses a selfie submitted as a government ID', async () => {
      mockPrisma.media.findUnique.mockResolvedValue(liveMedia('selfie'));
      allowSubmit();
      await expect(
        service.submitLiveVerification(
          userId,
          VerificationMethod.LIVE_GOVERNMENT_ID,
          'media-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a capture taken too long ago', async () => {
      mockPrisma.media.findUnique.mockResolvedValue(
        liveMedia('id', {
          createdAt: new Date(Date.now() - LIVE_CAPTURE_LIMITS.maxAgeMs - 1000),
        }),
      );
      allowSubmit();
      await expect(
        service.submitLiveVerification(
          userId,
          VerificationMethod.LIVE_GOVERNMENT_ID,
          'media-1',
        ),
      ).rejects.toThrow(/too long ago/);
    });

    it("refuses someone else's capture", async () => {
      mockPrisma.media.findUnique.mockResolvedValue(
        liveMedia('id', { ownerId: 'someone-else' }),
      );
      allowSubmit();
      await expect(
        service.submitLiveVerification(
          userId,
          VerificationMethod.LIVE_GOVERNMENT_ID,
          'media-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a capture already attached to an earlier attempt', async () => {
      mockPrisma.media.findUnique.mockResolvedValue(liveMedia('id'));
      allowSubmit();
      mockPrisma.verificationRequest.count.mockResolvedValue(1);
      await expect(
        service.submitLiveVerification(
          userId,
          VerificationMethod.LIVE_GOVERNMENT_ID,
          'media-1',
        ),
      ).rejects.toThrow(/already submitted/);
      expect(mockPrisma.verificationRequest.create).not.toHaveBeenCalled();
    });
  });
});
