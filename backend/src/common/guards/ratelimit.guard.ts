import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Optional,
} from '@nestjs/common';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import {
  applyRateLimitHeaders,
  rateLimitException,
} from '../rate-limit/rate-limit.response';
import { clientIp } from '../rate-limit/client-ip.util';
import { JwtGuard } from './jwt.guard';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';

/**
 * The global tier, applied to every route.
 *
 * WHAT WAS WRONG
 * --------------
 * The previous implementation keyed on `request.user?.id || request.ip`. Both
 * halves failed:
 *
 *   - `request.user` is populated by JwtGuard, which is a ROUTE guard. Nest
 *     runs global guards first, so `request.user` was undefined here for
 *     essentially every request and everything fell through to the IP branch.
 *   - `trust proxy` was never set, so `req.ip` resolved to the reverse proxy
 *     for all traffic.
 *
 * Together those turned a "100 requests per minute per client" limit into a
 * single shared bucket of 100 requests per minute for the entire platform — a
 * few simultaneous users could 429 everybody, while an attacker was not
 * meaningfully constrained at all.
 *
 * WHAT HAPPENS NOW
 * ----------------
 * The identity is resolved here rather than inherited from guard ordering, by
 * verifying the bearer token locally (cached, no network, no Supabase call).
 * Authenticated requests are counted per user; only genuinely anonymous ones
 * are counted per IP.
 *
 * The two tiers are mutually exclusive on purpose. A university campus behind
 * one NAT gateway presents thousands of students as a single address, so
 * applying the IP tier to authenticated traffic as well would take down a whole
 * campus at peak. Once a request proves who it is, the per-user budget governs.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    // Optional so the guard still functions in test modules that do not wire
    // authentication; without it every request is treated as anonymous.
    @Optional() private readonly jwtGuard?: JwtGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();

    // Liveness and readiness probes must never be rate limited: a 429 here
    // causes the outage it was meant to report.
    if (isProbe(request?.path ?? request?.url)) return true;

    const userId = await this.resolveUserId(request);

    const decision = userId
      ? await this.rateLimit.consume('global.user', userId)
      : await this.rateLimit.consumeAll([
          { policy: 'global.ip', identifier: clientIp(request) },
          { policy: 'global.ip.burst', identifier: clientIp(request) },
        ]);

    applyRateLimitHeaders(response, decision);

    if (!decision.allowed) {
      throw rateLimitException(decision, request?.id);
    }

    return true;
  }

  /**
   * The verified identity for this request, or null.
   *
   * Reads whatever a previous guard already attached first, then falls back to
   * verifying a token locally. Two token families exist and BOTH must be
   * handled: Supabase-issued user tokens, and admin session tokens signed with
   * ADMIN_JWT_ACCESS_SECRET which arrive in an `admin_access` cookie (not
   * necessarily an Authorization header). An admin whose identity went
   * unresolved would fall into the anonymous per-IP tier, so every admin in one
   * office would share a single 120/min budget while loading a dashboard.
   */
  private async resolveUserId(request: any): Promise<string | null> {
    if (request?.user?.id) return request.user.id;
    if (request?.admin?.id) return `admin:${request.admin.id}`;

    const header = request?.headers?.authorization;
    const bearer =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : null;

    if (bearer && this.jwtGuard) {
      try {
        const userId = await this.jwtGuard.peekUserId(bearer);
        if (userId) return userId;
      } catch {
        // Fall through — an unreadable token is treated as anonymous here, and
        // JwtGuard will reject it properly a moment later if the route needs it.
      }
    }

    return this.resolveAdminId(request, bearer);
  }

  /**
   * Admin identity from a locally-verified session token.
   *
   * Signature only — no database round-trip. AdminJwtGuard still does the real
   * checks (account active, session live, CSRF); all that is needed here is a
   * stable, unforgeable key to count against. Namespaced with `admin:` so an
   * admin id can never collide with a user id.
   */
  private resolveAdminId(request: any, bearer: string | null): string | null {
    const secret = config.auth.admin.accessSecret;
    if (!secret) return null;

    const token = request?.cookies?.admin_access || bearer;
    if (!token) return null;

    try {
      const payload: any = jwt.verify(token, secret, { algorithms: ['HS256'] });
      return payload?.sub ? `admin:${payload.sub}` : null;
    } catch {
      return null;
    }
  }
}

/** Health and readiness paths, matched before any limit is consumed. */
function isProbe(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  const p = path.split('?')[0].replace(/\/+$/, '').toLowerCase();
  return p === '/health' || p === '/healthz' || p === '/ready';
}
