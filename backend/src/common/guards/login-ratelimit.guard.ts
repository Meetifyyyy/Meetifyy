import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import {
  applyRateLimitHeaders,
  rateLimitException,
} from '../rate-limit/rate-limit.response';
import { clientIp } from '../rate-limit/client-ip.util';

/**
 * Brute-force / credential-stuffing protection for the server-side login proxy.
 *
 * Because login is proxied through this backend, Supabase sees only the
 * backend's address for every attempt and its own per-IP throttling can no
 * longer tell callers apart. This restores per-client limiting.
 *
 * The budget is unchanged (10 attempts per 5 minutes, then blocked for 5). What
 * changed is that the IP it counts against can no longer be chosen by the
 * caller: this used to read the leftmost `x-forwarded-for` entry, which is the
 * value the CLIENT sends, so any script could mint a fresh bucket per request
 * and the protection was decorative. It now uses `req.ip`, which Express
 * resolves from the right-hand end of the header according to the configured
 * trust-proxy hop count.
 *
 * On a Redis failure this keeps counting in-process rather than failing open —
 * an unmetered login endpoint during an outage is exactly what an attacker is
 * waiting for.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest();

    // Dimension 1 — per client IP. Spent on every attempt, successful or not:
    // this one exists to bound how fast a single host can work through a list
    // of accounts, and a successful login is part of that volume.
    const byIp = await this.rateLimit.consume(
      'auth.login.ip',
      clientIp(request),
    );

    // Dimension 2 — per targeted account. Only CHECKED here; the point is
    // spent by the controller if the attempt actually fails, so nobody can be
    // locked out of their own account by signing in successfully.
    const account = loginAccountKey(request);
    const byAccount = account
      ? await this.rateLimit.check('auth.login.account', account)
      : null;

    const decision =
      !byIp.allowed || !byAccount ? byIp : byAccount.allowed ? byIp : byAccount;

    applyRateLimitHeaders(http.getResponse(), decision);

    if (!decision.allowed) {
      throw rateLimitException(decision, request?.id);
    }

    return true;
  }
}

/**
 * The account a login attempt targets.
 *
 * `identifier` is whatever the user typed — a username or an email — and it is
 * normalised rather than resolved to a user id, because resolving it would mean
 * a database lookup on every attempt and would leak whether the account exists.
 * Counting the typed string is enough: an attacker targeting one account has to
 * type the same thing every time.
 */
export function loginAccountKey(request: any): string | null {
  const identifier = request?.body?.identifier;
  if (typeof identifier !== 'string') return null;
  const normalized = identifier.trim().toLowerCase();
  return normalized || null;
}
