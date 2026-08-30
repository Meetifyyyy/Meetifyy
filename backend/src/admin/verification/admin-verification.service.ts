import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VerificationStatus } from '@prisma/client';

@Injectable()
export class AdminVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async listRequests(status?: VerificationStatus, limit: number = 20, offset: number = 0) {
    const where = status ? { status } : {};
    
    const [total, requests] = await Promise.all([
      this.prisma.verificationRequest.count({ where }),
      this.prisma.verificationRequest.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              username: true,
              avatar: true,
            },
          },
          selfieMedia: true,
          idCardMedia: true,
        },
      }),
    ]);

    return { total, requests };
  }

  async updateStatus(id: string, status: VerificationStatus, adminNotes?: string) {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException('Verification request not found');
    }

    // Update the request and sync the status to the user
    const [updatedRequest, updatedUser] = await this.prisma.$transaction([
      this.prisma.verificationRequest.update({
        where: { id },
        data: {
          status,
        },
      }),
      this.prisma.user.update({
        where: { id: request.userId },
        data: {
          verificationStatus: status,
        },
      }),
    ]);

    return { request: updatedRequest, user: { id: updatedUser.id, verificationStatus: updatedUser.verificationStatus } };
  }
}
