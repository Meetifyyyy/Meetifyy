// The deletion controller pulls in services that reach sanitize-html, which
// ships ESM this Jest config does not transform. This suite only reads route
// metadata (same mocks as auth-ratelimit-wiring.spec.ts).
jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));

import { Reflector } from '@nestjs/core';
import { AccountDeletionController } from '../account-deletion/account-deletion.controller';
import { AccountEmailController } from '../account-email/account-email.controller';
import { ReauthController } from './reauth.controller';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { RATE_LIMIT_POLICIES_KEY } from '../common/rate-limit/rate-limit.decorator';
import { RATE_LIMIT_POLICIES } from '../config/rate-limit.config';

/**
 * Every route that spends a one-time code carries the per-user verify budget.
 *
 * `@RateLimit(...)` is only metadata; without `RateLimitPolicyGuard` on the
 * route it does nothing, and an unguarded route looks the same in a trace as a
 * protected one. So both halves are asserted, along with the order: the
 * class-level `JwtGuard` must run first because the policy is keyed on the
 * user it attaches.
 */
describe('OTP verification routes — per-user budget wiring', () => {
  const reflector = new Reflector();

  const routes: Array<[string, new (...args: never[]) => object, string]> = [
    [
      'POST account/delete/confirm',
      AccountDeletionController,
      'confirmDeletion',
    ],
    [
      'POST account/recover/confirm',
      AccountDeletionController,
      'confirmRecovery',
    ],
    ['POST account/reauth/code/verify', ReauthController, 'withCode'],
    ['POST account/email/verify', AccountEmailController, 'verify'],
  ];

  it.each(routes)(
    '%s is limited by auth.otp.verify.user',
    (_r, cls, method) => {
      const handler = Reflect.get(cls.prototype, method) as (
        ...args: never[]
      ) => unknown;
      expect(reflector.get(RATE_LIMIT_POLICIES_KEY, handler)).toEqual([
        'auth.otp.verify.user',
      ]);
      expect(Reflect.getMetadata('__guards__', handler)).toContain(
        RateLimitPolicyGuard,
      );
      // Class-level guards are applied before method-level ones.
      expect(Reflect.getMetadata('__guards__', cls)).toContain(JwtGuard);
    },
  );

  it('the policy exists, is per user, and fails closed', () => {
    expect(Object.keys(RATE_LIMIT_POLICIES)).toContain('auth.otp.verify.user');
    expect(RATE_LIMIT_POLICIES['auth.otp.verify.user']).toMatchObject({
      dimension: 'user',
      onRedisFailure: 'closed',
    });
  });
});
