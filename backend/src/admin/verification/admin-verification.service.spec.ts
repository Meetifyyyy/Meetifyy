import { Test, TestingModule } from '@nestjs/testing';
import { AdminVerificationService } from './admin-verification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';

describe('AdminVerificationService', () => {
  let service: AdminVerificationService;
  let prisma: PrismaService;

  const mockPrisma = {
    verificationRequest: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    $transaction: jest.fn((promises) => Promise.all(promises)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AdminVerificationService>(AdminVerificationService);
    prisma = module.get<PrismaService>(PrismaService);
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
      expect(result).toEqual({ total: 10, requests: [{ id: 'req-1' }] });
    });
  });

  describe('updateStatus', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.verificationRequest.findUnique.mockResolvedValue(null);
      await expect(service.updateStatus('invalid-id', VerificationStatus.VERIFIED)).rejects.toThrow(NotFoundException);
    });

    it('should update request and user status within a transaction', async () => {
      const mockRequest = { id: 'req-1', userId: 'user-1' };
      mockPrisma.verificationRequest.findUnique.mockResolvedValue(mockRequest);
      
      mockPrisma.verificationRequest.update.mockResolvedValue({ id: 'req-1', status: VerificationStatus.VERIFIED });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1', verificationStatus: VerificationStatus.VERIFIED });

      const result = await service.updateStatus('req-1', VerificationStatus.VERIFIED);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.verificationRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: VerificationStatus.VERIFIED },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { verificationStatus: VerificationStatus.VERIFIED },
      });

      expect(result).toEqual({
        request: { id: 'req-1', status: VerificationStatus.VERIFIED },
        user: { id: 'user-1', verificationStatus: VerificationStatus.VERIFIED },
      });
    });
  });
});
