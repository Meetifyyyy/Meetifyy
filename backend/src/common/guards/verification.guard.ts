import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { IS_VERIFIED_ONLY_KEY } from '../decorators/verified-only.decorator';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VerificationGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isVerifiedOnly = this.reflector.getAllAndOverride<boolean>(IS_VERIFIED_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isVerifiedOnly) {
      return true;
    }

    const request = context.getType() === 'http' ? context.switchToHttp().getRequest() : null;
    const client = context.getType() === 'ws' ? context.switchToWs().getClient() : null;
    const userId = request?.user?.id || client?.userId;

    const isVerificationEnabled = process.env.FEATURE_VERIFICATION_ENABLED !== 'false';
    
    if (isVerificationEnabled && userId) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { verificationStatus: true }
      });
      if (!dbUser || dbUser.verificationStatus !== VerificationStatus.VERIFIED) {
        if (context.getType() === 'ws') {
          throw new WsException('Account verification is required to perform this action.');
        } else {
          throw new ForbiddenException('Account verification is required to perform this action.');
        }
      }
    }

    return true;
  }
}
