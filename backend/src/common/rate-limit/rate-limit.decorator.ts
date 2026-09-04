import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicyName } from '../../config/rate-limit.config';

export const RATE_LIMIT_POLICIES_KEY = 'rateLimit:policies';

/**
 * Applies one or more named policies to a route.
 *
 *   @UseGuards(JwtGuard, RateLimitPolicyGuard)
 *   @RateLimit('auth.emailtrigger.user')
 *
 * Every listed policy is consumed and any of them can reject, so a composite
 * limit ("3 per hour per account AND 10 per day per IP") is expressed by
 * listing both rather than by writing a bespoke guard for the combination —
 * which is how this codebase ended up with four near-identical limiter guards.
 *
 * RateLimitPolicyGuard must come AFTER an authentication guard in @UseGuards
 * for any user-keyed policy, since it reads the identity that guard attached.
 */
export const RateLimit = (...policies: RateLimitPolicyName[]) =>
  SetMetadata(RATE_LIMIT_POLICIES_KEY, policies);
