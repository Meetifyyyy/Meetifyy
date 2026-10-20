import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { IS_VERIFIED_ONLY_KEY } from '../decorators/verified-only.decorator';
import {
  VerificationAccessService,
  verificationRequiredException,
} from '../verification/verification-access.service';
import { USER_ACCESS_COOKIE } from '../../auth/session/user-session-cookies';
import { JwtGuard } from './jwt.guard';
import type {
  OptionalAuthRequest,
  SocketIdentity,
} from '../types/authenticated-request';

@Injectable()
export class VerificationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    // The feature flag and the "which statuses count" rule both live in the
    // policy service now, so this guard and the messaging services can never
    // drift into two different definitions of "verified".
    private verificationAccess: VerificationAccessService,
    // Used to resolve the caller's identity on HTTP. This guard is an
    // APP_GUARD, which Nest runs BEFORE a route's @UseGuards(JwtGuard), so
    // `request.user` is never populated yet. Optional only so test modules that
    // do not wire authentication still build; without it an HTTP request whose
    // user is not already attached is refused, never waved through.
    @Optional() private readonly jwtGuard?: JwtGuard,
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
      context.getType() === 'http'
        ? context.switchToHttp().getRequest<OptionalAuthRequest>()
        : null;
    // The gateway keeps the socket's identity in `socket.data`.
    const client =
      context.getType() === 'ws'
        ? context.switchToWs().getClient<{ data?: SocketIdentity }>()
        : null;
    let userId: string | undefined | null =
      request?.user?.id || client?.data?.userId;

    // On HTTP the identity has to be resolved here rather than inherited from
    // guard ordering. It used to read `request.user` alone, which only JwtGuard
    // sets, so on every HTTP route @VerifiedOnly saw no user and let the
    // request through. Signature-verified locally (no network); JwtGuard still
    // does the full authentication, revocation and CSRF checks afterwards.
    if (!userId && request) {
      userId = await this.resolveHttpUserId(request);
      // Fail closed. A @VerifiedOnly route whose caller cannot be identified
      // is not a route to allow: the token is missing, forged or expired, and
      // JwtGuard would refuse it a moment later anyway.
      if (!userId && this.verificationAccess.isEnforcementEnabled()) {
        throw new UnauthorizedException('Authentication required');
      }
    }

    if (this.verificationAccess.isEnforcementEnabled() && userId) {
      const eligible = await this.verificationAccess.isUserEligible(userId);
      if (!eligible) {
        if (context.getType() === 'ws') {
          throw new WsException(
            'Account verification is required to perform this action.',
          );
        } else {
          throw verificationRequiredException();
        }
      }
    }

    return true;
  }

  /** Cookie first, then the Authorization header: JwtGuard's precedence. */
  private async resolveHttpUserId(
    request: OptionalAuthRequest,
  ): Promise<string | null> {
    if (!this.jwtGuard) return null;

    const rawCookie: unknown = request.cookies?.[USER_ACCESS_COOKIE];
    const header = request.headers?.authorization;
    const token =
      (typeof rawCookie === 'string' && rawCookie.trim()) ||
      (typeof header === 'string' ? header.replace('Bearer ', '').trim() : '');
    if (!token) return null;

    try {
      return await this.jwtGuard.peekUserId(token);
    } catch {
      return null;
    }
  }
}
