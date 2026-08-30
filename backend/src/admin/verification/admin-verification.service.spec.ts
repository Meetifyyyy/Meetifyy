import { Test, TestingModule } from '@nestjs/testing';
import { AdminVerificationService } from './admin-verification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../uploads/uploads.service';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { verificationAccessMockProvider } from '../../common/verification/testing/verification-access.mock';

describe('AdminVerificationService', () => {
  let service: AdminVerificationService;

  const mockPrisma = {
    verificationRequest: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    $transaction: jest.fn((promises) => Promise.all(promises)),
  };

  const mockStorage = {
    getReviewerSignedUrl: jest.fn(async (key: string) => `signed://${key}`),
  };

  /** Puts a request in `from` and lets the claim succeed. */
  const stubRequest = (from: VerificationStatus, userId = 'user-1') => {
    mockPrisma.verificationRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      userId,
      status: from,
    });
    mockPrisma.verificationRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.verificationRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'req-1',
      status: VerificationStatus.VERIFIED,
    });
    mockPrisma.user.update.mockResolvedValue({
      id: userId,
      verificationStatus: VerificationStatus.VERIFIED,
    });
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        verificationAccessMockProvider(),
        AdminVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get<AdminVerificationService>(AdminVerificationService);
    jest.clearAllMocks();
  });

  describe('listRequests', () => {
    it('should query requests with pagination and status', async () => {
      mockPrisma.verificationRequest.count.mockResolvedValue(10);
      mockPrisma.verificationRequest.findMany.mockResolvedValue([{ id: 'req-1' }]);

      const result = await service.listRequests(VerificationStatus.PENDING, 5, 2);

      expect(mockPrisma.verificationRequest.count).toHaveBeenCalledWith({ where: { status: VerificationStatus.PENDING } });
      expect(mockPrisma.verificationRequest.findMany).toHaveBeenCalledWith({
        where: { status: VerificationStatus.PENDING },
        take: 5,
        skip: 2,
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
      expect(result.total).toBe(10);
    });

    it('attaches a signed URL for each document so the reviewer can see them', async () => {
      // The admin UI reads `selfieMedia.url`. The raw media row has no such
      // field, so every request rendered a placeholder and reviewers were
      // approving documents they could not look at.
      mockPrisma.verificationRequest.count.mockResolvedValue(1);
      mockPrisma.verificationRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          selfieMedia: { id: 'm1', objectKey: 'verification/aaa.jpg' },
          idCardMedia: { id: 'm2', objectKey: 'verification/bbb.jpg' },
        },
      ]);

      const result = await service.listRequests();

      expect(result.requests[0].selfieMedia?.url).toBe(
        'signed://verification/aaa.jpg',
      );
      expect(result.requests[0].idCardMedia?.url).toBe(
        'signed://verification/bbb.jpg',
      );
      // Short-lived, not a public link.
      expect(mockStorage.getReviewerSignedUrl).toHaveBeenCalledWith(
        'verification/aaa.jpg',
        300,
      );
    });
  });

  describe('updateStatus', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.verificationRequest.findUnique.mockResolvedValue(null);
      await expect(service.updateStatus('invalid-id', VerificationStatus.VERIFIED)).rejects.toThrow(NotFoundException);
    });

    it('rejects a status value outside the enum', async () => {
      await expect(
        service.updateStatus('req-1', 'SUPERUSER' as any),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.verificationRequest.updateMany).not.toHaveBeenCalled();
    });

    it('approves a pending request and syncs the user row', async () => {
      stubRequest(VerificationStatus.PENDING);

      const result = await service.updateStatus('req-1', VerificationStatus.VERIFIED);

      expect(mockPrisma.verificationRequest.updateMany).toHaveBeenCalledWith({
        // Conditional on the status we read — this is the concurrency claim.
        where: { id: 'req-1', status: VerificationStatus.PENDING },
        data: { status: VerificationStatus.VERIFIED, rejectionReason: null },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { verificationStatus: VerificationStatus.VERIFIED },
      });
      expect(result.user.verificationStatus).toBe(VerificationStatus.VERIFIED);
    });

    it('persists the reviewer note as the rejection reason', async () => {
      stubRequest(VerificationStatus.PENDING);

      await service.updateStatus(
        'req-1',
        VerificationStatus.REJECTED,
        'ID photo was unreadable',
      );

      expect(mockPrisma.verificationRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: VerificationStatus.REJECTED,
            rejectionReason: 'ID photo was unreadable',
          },
        }),
      );
    });

    it('loses the race rather than overwriting a decision that already landed', async () => {
      stubRequest(VerificationStatus.PENDING);
      // Someone else decided between our read and our write.
      mockPrisma.verificationRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateStatus('req-1', VerificationStatus.REJECTED),
      ).rejects.toThrow(ConflictException);
      // Critically: the user row is NOT touched by the loser.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to re-decide an already rejected request', async () => {
      stubRequest(VerificationStatus.REJECTED);
      await expect(
        service.updateStatus('req-1', VerificationStatus.VERIFIED),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to push a request back into PENDING on the user’s behalf', async () => {
      stubRequest(VerificationStatus.VERIFIED);
      await expect(
        service.updateStatus('req-1', VerificationStatus.PENDING),
      ).rejects.toThrow(ConflictException);
    });

    it('allows revoking an already verified account', async () => {
      stubRequest(VerificationStatus.VERIFIED);
      await expect(
        service.updateStatus('req-1', VerificationStatus.REJECTED),
      ).resolves.toBeDefined();
    });
  });
});
