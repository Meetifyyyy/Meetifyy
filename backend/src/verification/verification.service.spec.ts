import { Test, TestingModule } from '@nestjs/testing';
import {
  LIVE_CAPTURE_LIMITS,
  VerificationService,
} from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { StorageService } from '../uploads/uploads.service';

/** A media lookup by id. */
type MediaLookup = { where: { id: string } };

describe('VerificationService', () => {
  let service: VerificationService;

  const mockStorage = { delete: jest.fn(() => Promise.resolve(true)) };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    media: {
      findUnique: jest.fn(),
      findMany: jest.fn((): Promise<unknown[]> => Promise.resolve([])),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    verificationRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn((): Promise<unknown[]> => Promise.resolve([])),
      count: jest.fn((): Promise<number> => Promise.resolve(0)),
    },
    $transaction: jest.fn(),
  };

  // Wired after the literal rather than inside it: the callback form hands back
  // `mockPrisma` itself, and referencing it during its own initialisation makes
  // its type circular. Submission runs both writes in one transaction; the
  // rollback this exists for is asserted in the e2e suite, not here.
  mockPrisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof mockPrisma) => unknown)(mockPrisma)
      : Promise.all(arg as unknown[]),
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

    service = module.get<VerificationService>(VerificationService);
    jest.clearAllMocks();
  });

  describe('submitVerification', () => {
    const userId = 'user-1';
    const selfieId = 'selfie-1';
    const idCardId = 'id-1';

    /**
     * A document that passes every validity check: a fresh live capture of the
     * kind its id stands for, as only the capture endpoint stores one.
     */
    const goodDoc = (id: string) => ({
      id,
      ownerId: userId,
      mimeType: 'image/jpeg',
      objectKey: `verification/live-${id === selfieId ? 'selfie' : 'id'}-${'a'.repeat(32)}.jpg`,
      createdAt: new Date(),
    });

    /** Both documents valid, and the status claim succeeds. */
    const happyPath = () => {
      mockPrisma.media.findUnique.mockImplementation(({ where }: MediaLookup) =>
        Promise.resolve(goodDoc(where.id)),
      );
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.verificationRequest.findFirst.mockResolvedValue(null);
      mockPrisma.verificationRequest.create.mockResolvedValue({
        id: 'req-1',
        attemptNumber: 1,
      });
    };

    it('refuses the same image for both documents', async () => {
      await expect(
        service.submitVerification(userId, selfieId, selfieId),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if selfie is invalid', async () => {
      mockPrisma.media.findUnique.mockImplementation(({ where }: MediaLookup) =>
        Promise.resolve(where.id === selfieId ? null : goodDoc(where.id)),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('Invalid selfie');
    });

    it('should throw BadRequestException if selfie belongs to someone else', async () => {
      mockPrisma.media.findUnique.mockImplementation(({ where }: MediaLookup) =>
        Promise.resolve(
          where.id === selfieId
            ? { ...goodDoc(where.id), ownerId: 'other-user' }
            : goodDoc(where.id),
        ),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('Invalid selfie');
    });

    it('should throw BadRequestException if id card is invalid', async () => {
      mockPrisma.media.findUnique.mockImplementation(({ where }: MediaLookup) =>
        Promise.resolve(where.id === idCardId ? null : goodDoc(where.id)),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('Invalid id card');
    });

    it('refuses a document that is not an image', async () => {
      // Ownership alone used to be the whole test, so any media the user owned
      // — a video, a voice note — could be submitted as an identity document.
      mockPrisma.media.findUnique.mockImplementation(({ where }: MediaLookup) =>
        Promise.resolve({
          ...goodDoc(where.id),
          mimeType: 'video/mp4',
        }),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('must be an image');
    });

    it('refuses a document stored outside the private verification prefix', async () => {
      // A chat image is publicly resolvable through /api/media; accepting one
      // as an ID card would publish the document.
      mockPrisma.media.findUnique.mockImplementation(({ where }: MediaLookup) =>
        Promise.resolve({
          ...goodDoc(where.id),
          objectKey: `chat/${where.id}.jpg`,
        }),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('uploaded through the verification flow');
    });

    describe('the documents must be live captures, as for live-request', () => {
      /** Serves `selfieId` and `idCardId` with `override` applied to one of them. */
      const serve = (
        target: string,
        override: Partial<ReturnType<typeof goodDoc>>,
      ) =>
        mockPrisma.media.findUnique.mockImplementation(
          ({ where }: MediaLookup) =>
            Promise.resolve({
              ...goodDoc(where.id),
              ...(where.id === target ? override : {}),
            }),
        );

      it('refuses a generic upload that merely sits under verification/', async () => {
        // What `POST /api/media/upload` used to store for folder=verification:
        // a random name, no re-encode, no freshness, no camera.
        happyPath();
        serve(selfieId, { objectKey: `verification/${'b'.repeat(32)}.jpg` });
        await expect(
          service.submitVerification(userId, selfieId, idCardId),
        ).rejects.toThrow('must be taken with the camera');
        expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      });

      it('refuses a capture of the wrong kind in either slot', async () => {
        happyPath();
        // The ID slot holds a selfie capture.
        serve(idCardId, {
          objectKey: `verification/live-selfie-${'a'.repeat(32)}.jpg`,
        });
        await expect(
          service.submitVerification(userId, selfieId, idCardId),
        ).rejects.toThrow('That photo is not a id card');
        expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      });

      it('refuses a capture older than the live window', async () => {
        happyPath();
        serve(selfieId, {
          createdAt: new Date(Date.now() - LIVE_CAPTURE_LIMITS.maxAgeMs - 1000),
        });
        await expect(
          service.submitVerification(userId, selfieId, idCardId),
        ).rejects.toThrow('taken too long ago');
        expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      });

      it('refuses a capture already attached to an earlier attempt', async () => {
        happyPath();
        // Once: clearAllMocks keeps implementations, and later tests need 0.
        mockPrisma.verificationRequest.count.mockResolvedValueOnce(1);
        await expect(
          service.submitVerification(userId, selfieId, idCardId),
        ).rejects.toThrow('already submitted');
        expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      });
    });

    it('should throw ConflictException if user is already pending', async () => {
      happyPath();
      // The conditional claim matches no row, because the status is not one of
      // the submittable ones.
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: VerificationStatus.PENDING,
      });
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if user is already verified', async () => {
      happyPath();
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: VerificationStatus.VERIFIED,
      });
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if user not found', async () => {
      happyPath();
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow(BadRequestException);
    });

    it('only one of two concurrent submissions is allowed through', async () => {
      happyPath();
      // Both callers validated their documents; the database lets exactly one
      // claim the UNVERIFIED → PENDING transition.
      let claims = 0;
      mockPrisma.user.updateMany.mockImplementation(() =>
        Promise.resolve({
          count: claims++ === 0 ? 1 : 0,
        }),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: VerificationStatus.PENDING,
      });

      const results = await Promise.allSettled([
        service.submitVerification(userId, selfieId, idCardId),
        service.submitVerification(userId, selfieId, idCardId),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      // One attempt row created, not two.
      expect(mockPrisma.verificationRequest.create).toHaveBeenCalledTimes(1);
    });

    it('keeps the documents a resubmission replaces', async () => {
      happyPath();
      // Retention is deliberate: verification documents are never deleted, so
      // the previous attempt keeps its selfie and ID in the bucket rather than
      // having them removed when a newer attempt is filed.
      mockPrisma.verificationRequest.findFirst.mockResolvedValue({
        attemptNumber: 1,
      });

      await service.submitVerification(userId, selfieId, idCardId);

      expect(mockStorage.delete).not.toHaveBeenCalled();
      expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
    });

    it('should successfully submit verification', async () => {
      happyPath();

      const result = await service.submitVerification(
        userId,
        selfieId,
        idCardId,
      );

      expect(mockPrisma.media.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [selfieId, idCardId] } },
        data: { visibility: 'private' },
      });
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: userId,
          verificationStatus: {
            in: [
              VerificationStatus.UNVERIFIED,
              VerificationStatus.REJECTED,
              VerificationStatus.RESUBMISSION_REQUIRED,
            ],
          },
        },
        data: { verificationStatus: VerificationStatus.PENDING },
      });
      expect(result).toEqual({ id: 'req-1', attemptNumber: 1 });
    });
  });

  describe('getStatus', () => {
    it('should return default UNVERIFIED if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.verificationRequest.findMany.mockResolvedValue([]);

      const result = await service.getStatus('user-1');
      expect(result).toEqual({
        status: VerificationStatus.UNVERIFIED,
        hasPendingRequest: false,
        request: null,
        history: [],
      });
    });

    it('should return user status and request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        verificationStatus: VerificationStatus.PENDING,
      });
      const attempts = [
        { attemptNumber: 2, status: VerificationStatus.PENDING },
        {
          attemptNumber: 1,
          status: VerificationStatus.REJECTED,
          rejectionReason: 'Blurry',
        },
      ];
      mockPrisma.verificationRequest.findMany.mockResolvedValue(attempts);

      const result = await service.getStatus('user-1');
      // `request` is the newest attempt; `history` retains the rejected one
      // along with the reason, which the old upsert model destroyed.
      expect(result).toEqual({
        status: VerificationStatus.PENDING,
        hasPendingRequest: true,
        request: attempts[0],
        history: attempts,
      });
    });
  });
});
