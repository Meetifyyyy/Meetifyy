import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import {
  applyRateLimitHeaders,
  rateLimitException,
} from '../rate-limit/rate-limit.response';
import { clientIp } from '../rate-limit/client-ip.util';

/**
 * Tighter budget for the unauthenticated auth probes — username/email
 * availability, username→email lookup, the reset-email check.
 *
 * These let a caller ask whether an account exists, so they get their own
 * per-IP allowance on top of the global tier, namespaced separately so they do
 * not share points with it.
 *
 * The budget is unchanged (20 per minute). What changed is the identifier: this
 * used to read the leftmost `x-forwarded-for` entry — a client-supplied value —
 * so an enumeration script could rotate the header and probe without limit. It
 * now uses `req.ip`.
 *
 * Marked sensitive in the policy, so the 429 carries no RateLimit-Remaining (it
 * would tell a prober exactly when to rotate) and a coarsened Retry-After.
 *
 * Paired with auth.probe.daily, because a per-minute limit alone does not stop
 * enumeration — 20/min sustained is ~28,800 probes a day, which walks the whole
 * user table without ever tripping the minute window.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest();

    // Both windows are consumed together. The per-minute budget shapes the
    // signup form; the daily budget is what actually closes enumeration, since
    // 20/min sustained is ~28,800 probes a day.
    const ip = clientIp(request);
    const decision = await this.rateLimit.consumeAll([
      { policy: 'auth.probe.ip', identifier: ip },
      { policy: 'auth.probe.daily', identifier: ip },
    ]);

    applyRateLimitHeaders(http.getResponse(), decision);

    if (!decision.allowed) {
      throw rateLimitException(decision, request?.id);
    }

    return true;
  }
}
