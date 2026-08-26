import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';

import { JwtGuard } from './jwt.guard';

/**
 * Attaches `request.user` when the caller happens to present a valid session,
 * and lets the request through untouched when they do not.
 *
 * Used by the public support endpoints. Those must work for someone who cannot
 * log in, but when a signed-in user files a request it is worth linking the
 * ticket to their account so support can see it without asking. Delegating to
 * JwtGuard rather than decoding the token here is the point: the verification
 * rules - signature, algorithm allow-list, JWKS rotation, expiry - stay in one
 * place. A second, more forgiving decoder is how a "just read the claims"
 * authentication bypass gets reintroduced.
 *
 * This guard never grants authority. `request.user` being set means only that
 * a token verified; every route using it still has to treat the anonymous case
 * as the normal one.
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  private readonly logger = new Logger(OptionalJwtGuard.name);

  constructor(private readonly jwtGuard: JwtGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const hasCredential = Boolean(
      request.headers?.authorization || request.cookies?.access_token,
    );

    // No credential offered: skip verification entirely rather than paying for
    // a failed lookup on every anonymous submission.
    if (!hasCredential) return true;

    try {
      await this.jwtGuard.canActivate(context);
    } catch {
      // An expired or malformed token is not an error on these routes - it is
      // the ordinary state of a user who cannot log in and is filing a support
      // request about exactly that. Left anonymous, deliberately not logged at
      // error level.
      this.logger.debug(
        'support.optional_auth_declined token present but not valid; continuing anonymously',
      );
      delete request.user;
    }

    return true;
  }
}
