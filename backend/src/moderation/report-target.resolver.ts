import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportTargetType } from '@prisma/client';

@Injectable()
export class ReportTargetResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fast check if a report target exists in DB
   */
  async exists(targetType: ReportTargetType, targetId: string): Promise<boolean> {
    switch (targetType) {
      case ReportTargetType.POST: {
        const post = await this.prisma.post.findUnique({ where: { id: targetId }, select: { id: true } });
        return !!post;
      }
      case ReportTargetType.COMMENT: {
        const comment = await this.prisma.comment.findUnique({ where: { id: targetId }, select: { id: true } });
        return !!comment;
      }
      case ReportTargetType.COMMUNITY: {
        const comm = await this.prisma.community.findUnique({ where: { id: targetId }, select: { id: true } });
        return !!comm;
      }
      case ReportTargetType.ACTIVITY: {
        const activity = await this.prisma.crewActivity.findUnique({ where: { id: targetId }, select: { id: true } });
        return !!activity;
      }
      case ReportTargetType.USER: {
        const user = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
        return !!user;
      }
      case ReportTargetType.MESSAGE: {
        const msg = await this.prisma.message.findUnique({ where: { id: targetId }, select: { id: true } });
        return !!msg;
      }
      case ReportTargetType.GROUP: {
        const conv = await this.prisma.conversation.findUnique({ where: { id: targetId }, select: { id: true } });
        return !!conv;
      }
      default:
        return false;
    }
  }

  /**
   * Hydrates preview payload for Super Admin Portal review
   */
  async resolveAndFetch(targetType: ReportTargetType, targetId: string): Promise<any> {
    switch (targetType) {
      case ReportTargetType.POST:
        return this.prisma.post.findUnique({
          where: { id: targetId },
          select: { id: true, text: true, createdAt: true, author: { select: { id: true, username: true, displayName: true, avatar: true } } },
        });
      case ReportTargetType.COMMENT:
        return this.prisma.comment.findUnique({
          where: { id: targetId },
          select: { id: true, text: true, createdAt: true, author: { select: { id: true, username: true, displayName: true, avatar: true } } },
        });
      case ReportTargetType.COMMUNITY:
        return this.prisma.community.findUnique({
          where: { id: targetId },
          select: { id: true, name: true, slug: true, description: true, memberCount: true },
        });
      case ReportTargetType.ACTIVITY:
        return this.prisma.crewActivity.findUnique({
          where: { id: targetId },
          select: { id: true, title: true, location: true, startDate: true },
        });
      case ReportTargetType.USER:
        return this.prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true, username: true, displayName: true, avatar: true, email: true, accountStatus: true },
        });
      case ReportTargetType.MESSAGE:
        return this.prisma.message.findUnique({
          where: { id: targetId },
          select: { id: true, payload: true, createdAt: true, senderId: true },
        });
      case ReportTargetType.GROUP:
        return this.prisma.conversation.findUnique({
          where: { id: targetId },
          select: { id: true, name: true, type: true, createdAt: true },
        });
      default:
        return null;
    }
  }
}
