import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportTargetType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** The account behind a confession, as a moderator is shown it. */
export interface RevealedConfessionAuthor {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

/** Where the request came from, recorded on the audit row. */
export interface RevealAuditContext {
  adminId: string;
  ip: string;
  endpoint: string;
  httpMethod: string;
  requestId: string | null;
}

export const CONFESSION_REVEAL_AUTHOR_ACTION = 'CONFESSION_REVEAL_AUTHOR';

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shows a moderator who wrote the confession a report is about.
   *
   * The audit row is written before the identity is returned and its failure
   * propagates: an author must never be disclosed without a record of who
   * asked and why. The row holds the report id and the reason only — the
   * target id already identifies the confession, and putting the author in the
   * log would make the log itself a way around the anonymity.
   */
  async revealConfessionAuthor(
    reportId: string,
    reason: string,
    context: RevealAuditContext,
  ): Promise<{ author: RevealedConfessionAuthor }> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, targetType: true, targetId: true },
    });
    if (!report) {
      throw new NotFoundException(`Report ${reportId} not found.`);
    }
    if (report.targetType !== ReportTargetType.CONFESSION) {
      throw new BadRequestException(
        'Only a report about a confession has a hidden author.',
      );
    }

    const confession = await this.prisma.confession.findUnique({
      where: { id: report.targetId },
      select: {
        id: true,
        profile: {
          select: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });
    const author = confession?.profile?.user;
    if (!confession || !author) {
      throw new NotFoundException('The confession or its author is gone.');
    }

    const newValue: Prisma.InputJsonObject = { reportId: report.id, reason };
    await this.prisma.auditLog.create({
      data: {
        adminId: context.adminId,
        action: CONFESSION_REVEAL_AUTHOR_ACTION,
        targetType: 'CONFESSION',
        targetId: confession.id,
        oldValue: Prisma.JsonNull,
        newValue,
        ip: context.ip,
        endpoint: context.endpoint,
        httpMethod: context.httpMethod,
        requestId: context.requestId,
      },
    });

    return { author };
  }
}
