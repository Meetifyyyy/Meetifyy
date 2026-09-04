import { HttpException, HttpStatus } from '@nestjs/common';
import type { RateLimitDecision } from './rate-limit.service';
import {
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
} from '../../config/rate-limit.config';

/** Stable, machine-readable code the client keys its handling off. */
export const RATE_LIMITED_ERROR_CODE = 'rate_limited';

/**
 * Applies the advisory headers for a decision.
 *
 * Field names follow draft-ietf-httpapi-ratelimit-headers (an active IETF
 * Internet-Draft, not yet an RFC) alongside Retry-After from RFC 9110, which is
 * the interoperable floor every client already understands.
 *
 * Sensitive policies get Retry-After ONLY. `RateLimit-Remaining` on an auth
 * endpoint tells a prober exactly how many attempts they have left before they
 * need to rotate, and the policy shape itself leaks how the endpoint is
 * defended.
 */
export function applyRateLimitHeaders(
  response: {
    setHeader?: (name: string, value: string) => void;
    removeHeader?: (name: string) => void;
  },
  decision: RateLimitDecision,
): void {
  if (!response?.setHeader) return;

  const spec = RATE_LIMIT_POLICIES[decision.policy] as RateLimitPolicy;

  if (!decision.allowed || decision.shadowed) {
    response.setHeader('Retry-After', String(retryAfterFor(decision)));
  }

  if (spec?.sensitive) {
    // Actively strip, don't just decline to set. The global tier runs first and
    // has already written its own RateLimit headers by this point, so returning
    // early would leave a sensitive route advertising a budget anyway.
    response.removeHeader?.('RateLimit');
    response.removeHeader?.('RateLimit-Policy');
    return;
  }

  response.setHeader(
    'RateLimit',
    `limit=${decision.limit}, remaining=${decision.remaining}, reset=${decision.resetSeconds}`,
  );
  response.setHeader(
    'RateLimit-Policy',
    `${decision.limit};w=${decision.windowSeconds}`,
  );
}

/**
 * Seconds a client should wait.
 *
 * Coarsened to a 15-second grid on sensitive policies: an exact countdown on a
 * login endpoint is a precise oracle for when the next attempt will land, and
 * rounding up costs a legitimate user nothing.
 */
export function retryAfterFor(decision: RateLimitDecision): number {
  const spec = RATE_LIMIT_POLICIES[decision.policy] as RateLimitPolicy;
  const seconds = Math.max(1, decision.resetSeconds);
  return spec?.sensitive ? Math.ceil(seconds / 15) * 15 : seconds;
}

/**
 * The 429 every limited route returns.
 *
 * One shape everywhere, so the client has a single branch to write. It carries
 * no policy name, no identifier and no indication of which dimension rejected —
 * a message reading "too many attempts for this account" would confirm the
 * account exists.
 */
export function rateLimitException(
  decision: RateLimitDecision,
  requestId?: string,
): HttpException {
  const spec = RATE_LIMIT_POLICIES[decision.policy] as RateLimitPolicy;
  const retryAfterSeconds = retryAfterFor(decision);

  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      // `code` rather than `error`: the client already branches on this field
      // for the suspension and pending-deletion states, so a 429 slots into the
      // handling that exists instead of needing its own convention.
      code: RATE_LIMITED_ERROR_CODE,
      message: spec?.message ?? 'Too many requests. Please try again shortly.',
      retryAfterSeconds,
      ...(requestId ? { requestId } : {}),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
