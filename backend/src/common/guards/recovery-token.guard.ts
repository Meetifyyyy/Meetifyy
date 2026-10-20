import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtGuard } from './jwt.guard';
import { isRecord } from '../utils/type-guards.util';
import type { OptionalAuthRequest } from '../types/authenticated-request';

/**
 * How old the recovery authentication may be, measured from the `amr`
 * timestamp (the moment the emailed link was redeemed).
 *
 * The link itself lives an hour (Supabase `otp_expiry` default) and the access
 * token it yields an hour more, and supabase-js refreshes that token without
 * resetting the `amr` timestamp. Two hours therefore covers a slow but genuine
 * reset, while a token minted by some old link redemption is refused.
 */
export const RECOVERY_MAX_AGE_SECONDS = 2 * 60 * 60;

/**
 * `amr` methods that a redeemed recovery link produces. GoTrue records the
 * emailed-code exchange as `otp` (the auth-js AMR list has no `recovery`
 * entry); `recovery` is accepted too in case a GoTrue version names it. A
 * password, OAuth or refresh-only token carries neither and is refused.
 */
const RECOVERY_AMR_METHODS = new Set(['recovery', 'otp']);

/**
 * Admits ONE route to a bare recovery token.
 *
 * `JwtGuard` refuses an `Authorization: Bearer` token that names no session,
 * and must keep doing so (a bare bearer bypasses every revocation). The
 * password-reset page, however, has only the recovery token: it is a fresh
 * browser session with no cookie and no `x-session-id`, and the account's
 * existing sessions are exactly what has to be ended. This guard is that
 * narrow exception, and it is narrow on purpose:
 *
 *  - the token must come from the `Authorization` header (never a cookie, so
 *    no CSRF surface);
 *  - its signature, issuer and expiry are verified locally;
 *  - it must have been issued by redeeming a recovery link, recently — an
 *    ordinary login token is not enough to reach this route;
 *  - it must carry a real email, which becomes the only possible recipient.
 *
 * It is not a general authenticator: it attaches a minimal user and is only
 * ever listed on `password-reset/finalize`.
 */
@Injectable()
export class RecoveryTokenGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OptionalAuthRequest>();

    const header = request.headers?.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : '';
    if (!token) throw new UnauthorizedException('Recovery token required');

    const claims = await this.jwtGuard.peekClaims(token);
    if (!claims) throw new UnauthorizedException('Invalid recovery token');

    const userId = typeof claims.sub === 'string' ? claims.sub : '';
    const email =
      typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!userId || !email) {
      throw new UnauthorizedException('Invalid recovery token');
    }

    if (!this.isFreshRecovery(claims)) {
      throw new UnauthorizedException('Recovery session is not valid');
    }

    request.user = {
      id: userId,
      email,
      user_metadata: isRecord(claims.user_metadata) ? claims.user_metadata : {},
      token,
    };
    return true;
  }

  private isFreshRecovery(claims: Record<string, unknown>): boolean {
    const amr = claims.amr;
    if (!Array.isArray(amr)) return false;
    const nowSeconds = Date.now() / 1000;

    return amr.some((entry: unknown) => {
      if (!isRecord(entry)) return false;
      const { method, timestamp } = entry;
      return (
        typeof method === 'string' &&
        RECOVERY_AMR_METHODS.has(method) &&
        typeof timestamp === 'number' &&
        Number.isFinite(timestamp) &&
        timestamp <= nowSeconds + 60 &&
        nowSeconds - timestamp <= RECOVERY_MAX_AGE_SECONDS
      );
    });
  }
}
