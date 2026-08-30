import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationStatus } from '@prisma/client';

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async submitVerification(userId: string, selfieMediaId: string, idCardMediaId: string) {
    // Check current status
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true },
    });

    if (!user) throw new BadRequestException('User not found');

    if (user.verificationStatus === VerificationStatus.VERIFIED || user.verificationStatus === VerificationStatus.PENDING) {
      throw new ConflictException(`Cannot submit verification while status is ${user.verificationStatus}`);
    }

    // Verify that media exists and belongs to user
    const selfie = await this.prisma.media.findUnique({ where: { id: selfieMediaId } });
    const idCard = await this.prisma.media.findUnique({ where: { id: idCardMediaId } });

    if (!selfie || selfie.ownerId !== userId) throw new BadRequestException('Invalid selfie media');
    if (!idCard || idCard.ownerId !== userId) throw new BadRequestException('Invalid id card media');

    // Update media visibility to private to ensure they aren't publicly exposed
    await this.prisma.media.updateMany({
      where: { id: { in: [selfieMediaId, idCardMediaId] } },
      data: { visibility: 'private' },
    });

    // Create or update verification request
    const request = await this.prisma.verificationRequest.upsert({
      where: { userId },
      create: {
        userId,
        selfieMediaId,
        idCardMediaId,
        status: VerificationStatus.PENDING,
      },
      update: {
        selfieMediaId,
        idCardMediaId,
        status: VerificationStatus.PENDING,
        rejectionReason: null,
        reviewerId: null,
      },
    });

    // Update user status
    await this.prisma.user.update({
      where: { id: userId },
      data: { verificationStatus: VerificationStatus.PENDING },
    });

    return request;
  }

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true },
    });
    
    const request = await this.prisma.verificationRequest.findUnique({
      where: { userId },
      select: { status: true, rejectionReason: true, createdAt: true, updatedAt: true },
    });

    return {
      status: user?.verificationStatus || VerificationStatus.UNVERIFIED,
      request: request || null,
    };
  }
}
