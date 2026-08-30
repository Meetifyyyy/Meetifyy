import { Test, TestingModule } from '@nestjs/testing';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';

describe('VerificationService', () => {
  let service: VerificationService;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    media: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    verificationRequest: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: PrismaService, useValue: mockPrisma },
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

    it('should throw BadRequestException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.submitVerification(userId, selfieId, idCardId)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if user is already pending', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ verificationStatus: VerificationStatus.PENDING });
      await expect(service.submitVerification(userId, selfieId, idCardId)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if user is already verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ verificationStatus: VerificationStatus.VERIFIED });
      await expect(service.submitVerification(userId, selfieId, idCardId)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if selfie is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ verificationStatus: VerificationStatus.UNVERIFIED });
      mockPrisma.media.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ownerId: userId }); // selfie null, id card valid
      await expect(service.submitVerification(userId, selfieId, idCardId)).rejects.toThrow('Invalid selfie media');
    });

    it('should throw BadRequestException if selfie belongs to someone else', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ verificationStatus: VerificationStatus.UNVERIFIED });
      mockPrisma.media.findUnique.mockResolvedValueOnce({ ownerId: 'other-user' }).mockResolvedValueOnce({ ownerId: userId });
      await expect(service.submitVerification(userId, selfieId, idCardId)).rejects.toThrow('Invalid selfie media');
    });

    it('should throw BadRequestException if id card is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ verificationStatus: VerificationStatus.UNVERIFIED });
      mockPrisma.media.findUnique.mockResolvedValueOnce({ ownerId: userId }).mockResolvedValueOnce(null); // id card null
      await expect(service.submitVerification(userId, selfieId, idCardId)).rejects.toThrow('Invalid id card media');
    });

    it('should successfully submit verification', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ verificationStatus: VerificationStatus.UNVERIFIED });
      mockPrisma.media.findUnique.mockResolvedValue({ ownerId: userId }); // both valid
      mockPrisma.verificationRequest.upsert.mockResolvedValue({ id: 'req-1' });

      const result = await service.submitVerification(userId, selfieId, idCardId);

      expect(mockPrisma.media.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [selfieId, idCardId] } },
        data: { visibility: 'private' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { verificationStatus: VerificationStatus.PENDING },
      });
      expect(result).toEqual({ id: 'req-1' });
    });
  });

  describe('getStatus', () => {
    it('should return default UNVERIFIED if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.verificationRequest.findUnique.mockResolvedValue(null);

      const result = await service.getStatus('user-1');
      expect(result).toEqual({ status: VerificationStatus.UNVERIFIED, request: null });
    });

    it('should return user status and request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ verificationStatus: VerificationStatus.PENDING });
      mockPrisma.verificationRequest.findUnique.mockResolvedValue({ status: VerificationStatus.PENDING });

      const result = await service.getStatus('user-1');
      expect(result).toEqual({ status: VerificationStatus.PENDING, request: { status: VerificationStatus.PENDING } });
    });
  });
});
