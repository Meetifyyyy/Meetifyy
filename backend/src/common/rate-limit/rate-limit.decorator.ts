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

export const SKIP_ANONYMOUS_GLOBAL_LIMIT_KEY = 'rateLimit:skipAnonymousGlobal';

/**
 * Exempts a route from the global tier that counts anonymous callers per IP.
 *
 * For a route whose callers are anonymous BY DEFINITION yet are real, signed-in
 * people: session refresh arrives with an expired access token, so the global
 * guard cannot name the user and would pool every device behind a shared
 * address (a campus) into one 120/min bucket on top of the route's own budget.
 * The route must declare its own limits with `@RateLimit` — this removes a
 * limit, it does not replace one. A request that DOES carry a valid token is
 * still counted per user.
 */
export const SkipAnonymousGlobalLimit = () =>
  SetMetadata(SKIP_ANONYMOUS_GLOBAL_LIMIT_KEY, true);
