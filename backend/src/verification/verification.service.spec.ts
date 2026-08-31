import { Test, TestingModule } from '@nestjs/testing';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { StorageService } from '../uploads/uploads.service';

describe('VerificationService', () => {
  let service: VerificationService;
  let prisma: PrismaService;

  const mockStorage = { delete: jest.fn(async () => true) };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    media: {
      findUnique: jest.fn(),
      findMany: jest.fn(async (): Promise<any[]> => []),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    verificationRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(async (): Promise<any[]> => []),
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
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('submitVerification', () => {
    const userId = 'user-1';
    const selfieId = 'selfie-1';
    const idCardId = 'id-1';

    /** A document that passes every validity check. */
    const goodDoc = (key: string) => ({
      id: key,
      ownerId: userId,
      mimeType: 'image/jpeg',
      objectKey: `verification/${key}.jpg`,
    });

    /** Both documents valid, and the status claim succeeds. */
    const happyPath = () => {
      mockPrisma.media.findUnique.mockImplementation(async ({ where }: any) =>
        goodDoc(where.id),
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
      mockPrisma.media.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === selfieId ? null : goodDoc(where.id),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('Invalid selfie');
    });

    it('should throw BadRequestException if selfie belongs to someone else', async () => {
      mockPrisma.media.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === selfieId
          ? { ...goodDoc(where.id), ownerId: 'other-user' }
          : goodDoc(where.id),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('Invalid selfie');
    });

    it('should throw BadRequestException if id card is invalid', async () => {
      mockPrisma.media.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === idCardId ? null : goodDoc(where.id),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('Invalid id card');
    });

    it('refuses a document that is not an image', async () => {
      // Ownership alone used to be the whole test, so any media the user owned
      // — a video, a voice note — could be submitted as an identity document.
      mockPrisma.media.findUnique.mockImplementation(
        async ({ where }: any) => ({
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
      mockPrisma.media.findUnique.mockImplementation(
        async ({ where }: any) => ({
          ...goodDoc(where.id),
          objectKey: `chat/${where.id}.jpg`,
        }),
      );
      await expect(
        service.submitVerification(userId, selfieId, idCardId),
      ).rejects.toThrow('uploaded through the verification flow');
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
      mockPrisma.user.updateMany.mockImplementation(async () => ({
        count: claims++ === 0 ? 1 : 0,
      }));
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
