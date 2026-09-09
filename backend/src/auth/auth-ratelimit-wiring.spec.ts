// EmailService pulls in sanitize-html, which ships ESM that this Jest config
// does not transform. Mocked for the same reason auth.controller.spec.ts does:
// this suite reads route metadata and never constructs the controller.
jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));

import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { AuthRateLimitGuard } from '../common/guards/auth-ratelimit.guard';
import { RATE_LIMIT_POLICIES_KEY } from '../common/rate-limit/rate-limit.decorator';
import { RATE_LIMIT_POLICIES } from '../config/rate-limit.config';

/**
 * The budgets on the routes that were moved here from the browser.
 *
 * Signup, code resend, the password-reset request and current-password
 * verification were all called directly against Supabase, so they passed
 * through nothing of ours and could not be limited at all. Being *behind* this
 * backend does not by itself meter them — a route missing its `@RateLimit`
 * decorator is silently unmetered, and looks identical in a request trace to
 * one that is protected. So the wiring is asserted rather than assumed.
 */
describe('AuthController — rate-limit wiring on the proxied auth routes', () => {
  const reflector = new Reflector();

  const handler = (method: string): any =>
    (AuthController.prototype as Record<string, any>)[method];

  const policiesOn = (method: string): string[] =>
    reflector.get(RATE_LIMIT_POLICIES_KEY, handler(method)) ?? [];

  const guardsOn = (method: string): any[] =>
    Reflect.getMetadata('__guards__', handler(method)) ?? [];

  it.each([
    ['signUp', ['auth.signup.ip', 'auth.signup.account']],
    ['resendSignupOtp', ['auth.signup.ip', 'auth.signup.account']],
    ['requestPasswordReset', ['auth.passwordreset.account']],
    ['verifyPassword', ['auth.verifypassword.user']],
  ])('%s declares %j', (method, expected) => {
    expect(policiesOn(method)).toEqual(expected);
  });

  it('every declared policy actually exists in the policy map', () => {
    // A typo in a policy name is not a compile error at the metadata layer, and
    // an unknown policy is one the guard cannot enforce.
    for (const method of [
      'signUp',
      'resendSignupOtp',
      'requestPasswordReset',
      'verifyPassword',
    ]) {
      for (const policy of policiesOn(method)) {
        // Object.keys, not toHaveProperty: policy names contain dots, which
        // toHaveProperty reads as a nested path.
        expect(Object.keys(RATE_LIMIT_POLICIES)).toContain(policy);
      }
    }
  });

  it('mounts RateLimitPolicyGuard on each of them', () => {
    for (const method of [
      'signUp',
      'resendSignupOtp',
      'requestPasswordReset',
      'verifyPassword',
    ]) {
      expect(guardsOn(method)).toContain(RateLimitPolicyGuard);
    }
  });

  it('puts JwtGuard BEFORE RateLimitPolicyGuard on verify-password', () => {
    // `auth.verifypassword.user` is user-keyed, and the policy guard reads the
    // identity the auth guard attaches. Reversed, the policy guard throws
    // rather than silently skipping — but only at request time, on a route
    // whose whole job is to be a brute-force bound.
    const guards = guardsOn('verifyPassword');
    expect(guards.indexOf(JwtGuard)).toBeGreaterThanOrEqual(0);
    expect(guards.indexOf(JwtGuard)).toBeLessThan(
      guards.indexOf(RateLimitPolicyGuard),
    );
  });

  it('keeps the per-IP probe budget on the password-reset request', () => {
    // The per-account policy bounds mail to one address; this is what bounds
    // one host walking many addresses.
    expect(guardsOn('requestPasswordReset')).toContain(AuthRateLimitGuard);
  });

  it('leaves signup and resend unauthenticated', () => {
    // Both are reached before an account can possibly have a session. A JwtGuard
    // here would not tighten anything, it would break signup.
    expect(guardsOn('signUp')).not.toContain(JwtGuard);
    expect(guardsOn('resendSignupOtp')).not.toContain(JwtGuard);
  });

  it('marks every one of these budgets sensitive', () => {
    // A 429 that carries RateLimit-Remaining tells a prober exactly when to
    // rotate, and on these routes it would also confirm an address exists.
    for (const policy of [
      'auth.signup.ip',
      'auth.signup.account',
      'auth.passwordreset.account',
      'auth.verifypassword.user',
    ] as const) {
      expect(RATE_LIMIT_POLICIES[policy].sensitive).toBe(true);
    }
  });

  it('keeps counting these when Redis is down', () => {
    // An unmetered auth endpoint during an outage is exactly what an attacker
    // is waiting for, so these fall back to in-process counting rather than
    // failing open.
    for (const policy of [
      'auth.signup.ip',
      'auth.signup.account',
      'auth.passwordreset.account',
      'auth.verifypassword.user',
    ] as const) {
      expect(RATE_LIMIT_POLICIES[policy].onRedisFailure).toBe('closed');
    }
  });
});
