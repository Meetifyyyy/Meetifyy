import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportTargetResolver } from './report-target.resolver';
import { ReportRateLimitService } from './report-ratelimit.service';
import { SubmitReportDto } from './dto/submit-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { BulkActionReportDto } from './dto/bulk-action-report.dto';
import { ReportStatus, ReportPriority } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targetResolver: ReportTargetResolver,
    private readonly rateLimitService: ReportRateLimitService,
    @InjectPinoLogger(ModerationService.name)
    private readonly logger: PinoLogger,
    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * Submit a user or content report with full security checks
   */
  async submitReport(
    reporterId: string,
    dto: SubmitReportDto,
    ip: string = '0.0.0.0',
    userAgent: string = 'Unknown',
  ) {
    try {
      // 1. Prevent self-reporting
      if (dto.targetType === 'USER' && dto.targetId === reporterId) {
        throw new BadRequestException('You cannot report your own profile.');
      }

      // 2. Validate target existence via Target Resolver
      const targetExists = await this.targetResolver.exists(dto.targetType, dto.targetId);
      if (!targetExists) {
        Sentry.captureMessage(`Report submit failed: Target missing [${dto.targetType}:${dto.targetId}]`, 'warning');
        throw new NotFoundException(`The reported ${dto.targetType.toLowerCase()} could not be found.`);
      }

      // 3. Multi-window rate limit check
      const rateCheck = await this.rateLimitService.checkRateLimit(reporterId);
      if (!rateCheck.success) {
        throw new HttpException(
          `Rate limit exceeded: Maximum ${rateCheck.limitType} reports allowed.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 4. Duplicate protection: reject if user has active PENDING / UNDER_REVIEW report for this target
      const existingActiveReport = await this.prisma.report.findFirst({
        where: {
          reporterId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          status: { in: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW] },
        },
      });

      if (existingActiveReport) {
        throw new ConflictException('You have already submitted an active report for this item.');
      }

      // 5. Build metadata object
      const fullMetadata = {
        ...(dto.metadata || {}),
        ip,
        userAgent,
        submittedAt: new Date().toISOString(),
      };

      // 6. Create Report in Prisma
      const report = await this.prisma.report.create({
        data: {
          reporterId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reason: dto.reason,
          description: dto.description || null,
          metadata: fullMetadata,
          status: ReportStatus.PENDING,
          priority: ReportPriority.MEDIUM,
        },
      });

      // 7. Pino Audit Log
      this.logger.info({
        event: 'report.submitted',
        reportId: report.id,
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        ip,
        userAgent,
      });

      // 8. Queue notification for moderators (Async)
      try {
        await this.notificationQueue.add(
          'moderator-report-alert',
          {
            reportId: report.id,
            targetType: report.targetType,
            targetId: report.targetId,
            reason: report.reason,
          },
          { removeOnComplete: true },
        );
      } catch (err) {
        this.logger.warn('Failed to enqueue moderator notification task', err);
      }

      return {
        success: true,
        reportId: report.id,
        message: 'Report submitted successfully.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      this.logger.error('Unexpected failure during report submission', error);
      Sentry.captureException(error);
      throw new HttpException('Failed to process report submission.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Super Admin / Moderator: Query paginated reports queue
   */
  async listReports(query: {
    status?: ReportStatus;
    targetType?: any;
    priority?: ReportPriority;
    reporterId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status) where.status = query.status;
    if (query.targetType) where.targetType = query.targetType;
    if (query.priority) where.priority = query.priority;
    if (query.reporterId) where.reporterId = query.reporterId;

    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { targetId: { contains: query.search, mode: 'insensitive' } },
        { reporter: { username: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [total, reports] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      data: reports,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Super Admin Dashboard: Moderation Analytics & Stats
   */
  async getReportStats() {
    const [statusCounts, priorityCounts, targetTypeCounts, total] = await Promise.all([
      this.prisma.report.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.report.groupBy({
        by: ['priority'],
        _count: { _all: true },
      }),
      this.prisma.report.groupBy({
        by: ['targetType'],
        _count: { _all: true },
      }),
      this.prisma.report.count(),
    ]);

    return {
      total,
      byStatus: statusCounts.reduce((acc, curr) => ({ ...acc, [curr.status]: curr._count._all }), {}),
      byPriority: priorityCounts.reduce((acc, curr) => ({ ...acc, [curr.priority]: curr._count._all }), {}),
      byTargetType: targetTypeCounts.reduce((acc, curr) => ({ ...acc, [curr.targetType]: curr._count._all }), {}),
    };
  }

  /**
   * Super Admin / Moderator: Get detailed report view with hydrated target content preview
   */
  async getReportById(id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        reporter: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            email: true,
            accountStatus: true,
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException(`Report with ID ${id} not found.`);
    }

    const targetContent = await this.targetResolver.resolveAndFetch(report.targetType, report.targetId);

    return {
      ...report,
      targetContent,
    };
  }

  /**
   * Super Admin / Moderator: Update single report status/priority/resolution
   */
  async updateReport(id: string, dto: UpdateReportDto, adminUserId?: string) {
    const existing = await this.prisma.report.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Report ${id} not found.`);
    }

    const data: any = { ...dto };

    if (dto.status === ReportStatus.RESOLVED || dto.status === ReportStatus.REJECTED) {
      data.resolvedAt = new Date();
      if (adminUserId) data.resolvedBy = adminUserId;
    }

    const updated = await this.prisma.report.update({
      where: { id },
      data,
    });

    this.logger.info({
      event: 'report.updated',
      reportId: id,
      adminUserId,
      previousStatus: existing.status,
      newStatus: updated.status,
    });

    return updated;
  }

  /**
   * Super Admin: Bulk update actions for batch moderation
   */
  async bulkAction(dto: BulkActionReportDto, adminUserId?: string) {
    const data: any = {};
    if (dto.status) data.status = dto.status;
    if (dto.priority) data.priority = dto.priority;
    if (dto.assignedModeratorId) data.assignedModeratorId = dto.assignedModeratorId;
    if (dto.resolution) data.resolution = dto.resolution;

    if (dto.status === ReportStatus.RESOLVED || dto.status === ReportStatus.REJECTED) {
      data.resolvedAt = new Date();
      if (adminUserId) data.resolvedBy = adminUserId;
    }

    const result = await this.prisma.report.updateMany({
      where: { id: { in: dto.reportIds } },
      data,
    });

    this.logger.info({
      event: 'report.bulk_action',
      adminUserId,
      count: result.count,
      reportIds: dto.reportIds,
    });

    return { success: true, count: result.count };
  }
}
