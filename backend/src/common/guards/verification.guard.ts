import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { IS_VERIFIED_ONLY_KEY } from '../decorators/verified-only.decorator';
import { VerificationAccessService } from '../verification/verification-access.service';

@Injectable()
export class VerificationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    // The feature flag and the "which statuses count" rule both live in the
    // policy service now, so this guard and the messaging services can never
    // drift into two different definitions of "verified".
    private verificationAccess: VerificationAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isVerifiedOnly = this.reflector.getAllAndOverride<boolean>(
      IS_VERIFIED_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isVerifiedOnly) {
      return true;
    }

    const request =
      context.getType() === 'http' ? context.switchToHttp().getRequest() : null;
    const client =
      context.getType() === 'ws' ? context.switchToWs().getClient() : null;
    const userId = request?.user?.id || client?.userId;

    if (this.verificationAccess.isEnforcementEnabled() && userId) {
      const eligible = await this.verificationAccess.isUserEligible(userId);
      if (!eligible) {
        if (context.getType() === 'ws') {
          throw new WsException(
            'Account verification is required to perform this action.',
          );
        } else {
          throw new ForbiddenException(
            'Account verification is required to perform this action.',
          );
        }
      }
    }

    return true;
  }
}
