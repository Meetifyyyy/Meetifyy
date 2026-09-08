import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service';
import {
  applyRateLimitHeaders,
  rateLimitException,
} from './rate-limit.response';
import { clientIp } from './client-ip.util';
import { normalizeEmail } from '../validation/email-format.util';
import { RATE_LIMIT_POLICIES_KEY } from './rate-limit.decorator';
import {
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
  type RateLimitPolicyName,
} from '../../config/rate-limit.config';

/**
 * Enforces whatever policies a route declares with `@RateLimit(...)`.
 *
 * One guard for every endpoint-specific limit, so adding a limit is a one-line
 * decorator plus an entry in the policy map rather than a new guard class. The
 * identifier for each policy comes from its declared dimension, which keeps the
 * choice of "what do we count" in the config next to the numbers instead of
 * scattered across guards.
 */
@Injectable()
export class RateLimitPolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policies = this.reflector.getAllAndOverride<RateLimitPolicyName[]>(
      RATE_LIMIT_POLICIES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!policies?.length) return true;

    const http = context.switchToHttp();
    const request = http.getRequest();

    const entries = policies
      .map((policy) => {
        const identifier = this.identifierFor(policy, request);
        return identifier ? { policy, identifier } : null;
      })
      .filter((e): e is { policy: RateLimitPolicyName; identifier: string } =>
        Boolean(e),
      );

    if (!entries.length) {
      // Every declared policy resolved to no identifier. For a resource-keyed
      // policy that is expected (it is enforced in the service layer), but a
      // route whose ONLY policies resolve to nothing is silently unguarded, so
      // say so rather than passing quietly.
      const allResource = policies.every(
        (p) =>
          (RATE_LIMIT_POLICIES[p] as RateLimitPolicy).dimension === 'resource',
      );
      if (!allResource) {
        new Logger(RateLimitPolicyGuard.name).warn(
          `ratelimit.policy_skipped ${JSON.stringify({
            route: request?.url,
            policies,
            reason: 'no identifier resolved for any declared policy',
          })}`,
        );
      }
      return true;
    }

    const decision = await this.rateLimit.consumeAll(entries);
    applyRateLimitHeaders(http.getResponse(), decision);

    if (!decision.allowed) {
      throw rateLimitException(decision, request?.id);
    }

    return true;
  }

  /**
   * The value a policy counts against, chosen by its declared dimension.
   *
   * Returns null when the dimension has no value on this request — an
   * unauthenticated call to a user-keyed policy, or a body with no email — and
   * that policy is then skipped rather than silently collapsing everyone into a
   * shared "anonymous" bucket, which is the failure mode that made the old
   * global limiter useless.
   */
  private identifierFor(
    policy: RateLimitPolicyName,
    request: any,
  ): string | null {
    const spec = RATE_LIMIT_POLICIES[policy] as RateLimitPolicy;

    switch (spec.dimension) {
      case 'user': {
        const id = request?.user?.id ?? request?.admin?.id;
        if (!id) {
          // A user-keyed policy on a route with no authentication is a wiring
          // mistake, and silently skipping it would leave the route unguarded.
          throw new InternalServerErrorException(
            `Rate-limit policy "${policy}" is user-keyed but no authenticated user is present. Place an auth guard before RateLimitPolicyGuard.`,
          );
        }
        return String(id);
      }

      case 'ip':
        return clientIp(request);

      case 'account': {
        const raw = request?.body?.email ?? request?.body?.identifier;
        if (typeof raw !== 'string') return null;

        // The SAME normalisation the services use to resolve the address, not
        // a lookalike. This used to be `trim().toLowerCase()`, which agrees
        // with `normalizeEmail` on case and whitespace and disagrees with it on
        // everything else it does — stripping invisible characters, and NFKC.
        //
        // That gap was a way out of every per-account budget. `ｖictim@x.com`
        // (fullwidth v) and `victim<ZWSP>@x.com` both satisfy `@IsEmail`, so
        // they reach the service; the service folds both to `victim@x.com` and
        // mails the real person; and each one landed in a BUCKET OF ITS OWN
        // here. An attacker could mint a fresh budget per request and point the
        // resulting mail at one address — which is precisely what the
        // per-account dimension exists to stop, the per-IP one having already
        // failed to (that is the whole reason both exist).
        //
        // Guards run before validation pipes, so this deliberately does not
        // care whether the value is a valid address: it only has to key the
        // same way the service will resolve it.
        const normalized = normalizeEmail(raw);
        return normalized || null;
      }

      case 'resource':
        // Resource-keyed policies are enforced in the service layer, after the
        // ownership check has run — a 429 that fires before authorization would
        // confirm the resource exists.
        return null;

      default:
        return null;
    }
  }
}
