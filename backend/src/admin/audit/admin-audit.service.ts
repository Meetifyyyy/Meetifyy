import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(query: {
    action?: string;
    targetType?: string;
    adminId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.adminId) where.adminId = query.adminId;

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
    ]);

    return {
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSecurityEvents(query: { page?: number; limit?: number }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [total, events] = await Promise.all([
      this.prisma.securityEvent.count(),
      this.prisma.securityEvent.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: events,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getLoginAudits(query: { page?: number; limit?: number }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [total, audits] = await Promise.all([
      this.prisma.loginAudit.count(),
      this.prisma.loginAudit.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return {
      data: audits,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
