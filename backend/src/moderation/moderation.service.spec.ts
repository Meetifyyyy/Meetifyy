import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModerationService } from './moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportTargetResolver } from './report-target.resolver';
import { ReportRateLimitService } from './report-ratelimit.service';
import { ReportStatus, ReportPriority, ReportTargetType } from '@prisma/client';

// Sentry is a side-effect dependency — silence it in tests.
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('ModerationService', () => {
  let service: ModerationService;

  const mockPrisma = {
    report: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const mockTargetResolver = {
    exists: jest.fn(),
  };

  const mockRateLimitService = {
    checkRateLimit: jest.fn(),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockNotificationQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ReportTargetResolver, useValue: mockTargetResolver },
        { provide: ReportRateLimitService, useValue: mockRateLimitService },
        // PinoLogger token — nestjs-pino uses a custom injection token
        {
          provide: 'PinoLogger:ModerationService',
          useValue: mockLogger,
        },
        {
          provide: 'BullQueue_notifications',
          useValue: mockNotificationQueue,
        },
      ],
    }).compile();

    service = module.get(ModerationService);
    jest.clearAllMocks();
  });

  // ── submitReport ──────────────────────────────────────────────────────────

  describe('submitReport', () => {
    const reporterId = 'user-1';
    const validDto = {
      targetType: ReportTargetType.POST,
      targetId: 'post-1',
      reason: 'SPAM' as any,
      description: 'This is spam',
    };

    function setupHappyPath() {
      mockTargetResolver.exists.mockResolvedValue(true);
      mockRateLimitService.checkRateLimit.mockResolvedValue({ success: true });
      mockPrisma.report.findFirst.mockResolvedValue(null); // no duplicate
      mockPrisma.report.create.mockResolvedValue({
        id: 'report-1',
        ...validDto,
        reporterId,
        status: ReportStatus.PENDING,
        priority: ReportPriority.MEDIUM,
      });
      mockNotificationQueue.add.mockResolvedValue(undefined);
    }

    it('throws BadRequestException when reporter tries to self-report', async () => {
      await expect(
        service.submitReport(
          'user-1',
          { ...validDto, targetType: ReportTargetType.USER, targetId: 'user-1' },
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.submitReport(
          'user-1',
          { ...validDto, targetType: ReportTargetType.USER, targetId: 'user-1' },
        ),
      ).rejects.toThrow('You cannot report your own profile.');
    });

    it('throws NotFoundException when the target does not exist', async () => {
      mockTargetResolver.exists.mockResolvedValue(false);
      await expect(service.submitReport(reporterId, validDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws HTTP 429 when the short rate limit is exceeded', async () => {
      mockTargetResolver.exists.mockResolvedValue(true);
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        success: false,
        limitType: '10-minute (5 max)',
      });
      const err = await service.submitReport(reporterId, validDto).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('throws ConflictException for a duplicate active report on the same target', async () => {
      mockTargetResolver.exists.mockResolvedValue(true);
      mockRateLimitService.checkRateLimit.mockResolvedValue({ success: true });
      mockPrisma.report.findFirst.mockResolvedValue({ id: 'existing-report' });
      await expect(service.submitReport(reporterId, validDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.submitReport(reporterId, validDto)).rejects.toThrow(
        'You have already submitted an active report for this item.',
      );
    });

    it('creates the report and returns the expected shape on a happy path', async () => {
      setupHappyPath();
      const result = await service.submitReport(reporterId, validDto);
      expect(result.success).toBe(true);
      expect(result.reportId).toBe('report-1');
      expect(mockPrisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reporterId,
            targetType: validDto.targetType,
            targetId: validDto.targetId,
            reason: validDto.reason,
            status: ReportStatus.PENDING,
            priority: ReportPriority.MEDIUM,
          }),
        }),
      );
    });

    it('enriches the metadata with ip and userAgent', async () => {
      setupHappyPath();
      await service.submitReport(reporterId, validDto, '1.2.3.4', 'TestAgent/1');
      const createCall = mockPrisma.report.create.mock.calls[0][0];
      expect(createCall.data.metadata).toMatchObject({
        ip: '1.2.3.4',
        userAgent: 'TestAgent/1',
      });
    });

    it('enqueues a notification for moderators after creation', async () => {
      setupHappyPath();
      await service.submitReport(reporterId, validDto);
      expect(mockNotificationQueue.add).toHaveBeenCalledWith(
        'moderator-report-alert',
        expect.objectContaining({ reportId: 'report-1' }),
        expect.any(Object),
      );
    });

    it('still succeeds even when the notification queue fails', async () => {
      setupHappyPath();
      mockNotificationQueue.add.mockRejectedValue(new Error('queue down'));
      await expect(service.submitReport(reporterId, validDto)).resolves.toMatchObject({
        success: true,
      });
    });
  });

  // ── updateReport ──────────────────────────────────────────────────────────

  describe('updateReport', () => {
    it('throws NotFoundException when report does not exist', async () => {
      mockPrisma.report.findUnique.mockResolvedValue(null);
      await expect(
        service.updateReport('bad-id', { status: ReportStatus.RESOLVED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates and returns the updated report', async () => {
      const existing = {
        id: 'r-1',
        status: ReportStatus.PENDING,
      };
      const updated = { ...existing, status: ReportStatus.RESOLVED, resolvedAt: new Date() };
      mockPrisma.report.findUnique.mockResolvedValue(existing);
      mockPrisma.report.update.mockResolvedValue(updated);

      const result = await service.updateReport('r-1', {
        status: ReportStatus.RESOLVED,
      });
      expect(result.status).toBe(ReportStatus.RESOLVED);
    });

    it('sets resolvedAt and resolvedBy when status is RESOLVED', async () => {
      mockPrisma.report.findUnique.mockResolvedValue({ id: 'r-1', status: ReportStatus.PENDING });
      mockPrisma.report.update.mockResolvedValue({ id: 'r-1', status: ReportStatus.RESOLVED });

      await service.updateReport(
        'r-1',
        { status: ReportStatus.RESOLVED },
        'admin-1',
      );

      const updateCall = mockPrisma.report.update.mock.calls[0][0];
      expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
      expect(updateCall.data.resolvedBy).toBe('admin-1');
    });

    it('sets resolvedAt when status is REJECTED', async () => {
      mockPrisma.report.findUnique.mockResolvedValue({ id: 'r-1', status: ReportStatus.PENDING });
      mockPrisma.report.update.mockResolvedValue({ id: 'r-1', status: ReportStatus.REJECTED });

      await service.updateReport('r-1', { status: ReportStatus.REJECTED });

      const updateCall = mockPrisma.report.update.mock.calls[0][0];
      expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
    });

    it('does NOT set resolvedAt for intermediate statuses', async () => {
      mockPrisma.report.findUnique.mockResolvedValue({ id: 'r-1', status: ReportStatus.PENDING });
      mockPrisma.report.update.mockResolvedValue({ id: 'r-1', status: ReportStatus.UNDER_REVIEW });

      await service.updateReport('r-1', { status: ReportStatus.UNDER_REVIEW });

      const updateCall = mockPrisma.report.update.mock.calls[0][0];
      expect(updateCall.data.resolvedAt).toBeUndefined();
    });
  });

  // ── bulkAction ────────────────────────────────────────────────────────────

  describe('bulkAction', () => {
    it('updates all report IDs in the batch and returns the count', async () => {
      mockPrisma.report.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.bulkAction({
        reportIds: ['r-1', 'r-2', 'r-3'],
        status: ReportStatus.RESOLVED,
      });

      expect(result).toEqual({ success: true, count: 3 });
      expect(mockPrisma.report.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['r-1', 'r-2', 'r-3'] } },
        }),
      );
    });

    it('stamps resolvedAt when bulk-resolving', async () => {
      mockPrisma.report.updateMany.mockResolvedValue({ count: 2 });

      await service.bulkAction({
        reportIds: ['r-1', 'r-2'],
        status: ReportStatus.RESOLVED,
      }, 'admin-99');

      const updateCall = mockPrisma.report.updateMany.mock.calls[0][0];
      expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
      expect(updateCall.data.resolvedBy).toBe('admin-99');
    });

    it('does not set resolvedAt for non-terminal statuses', async () => {
      mockPrisma.report.updateMany.mockResolvedValue({ count: 1 });

      await service.bulkAction({
        reportIds: ['r-1'],
        status: ReportStatus.UNDER_REVIEW,
      });

      const updateCall = mockPrisma.report.updateMany.mock.calls[0][0];
      expect(updateCall.data.resolvedAt).toBeUndefined();
    });
  });

  // ── getReportById ─────────────────────────────────────────────────────────

  describe('getReportById', () => {
    it('throws NotFoundException when the report does not exist', async () => {
      mockPrisma.report.findUnique.mockResolvedValue(null);
      await expect(service.getReportById('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
