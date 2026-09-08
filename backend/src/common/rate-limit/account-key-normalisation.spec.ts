import { RateLimitPolicyGuard } from './rate-limit-policy.guard';
import { loginAccountKey } from '../guards/login-ratelimit.guard';
import { normalizeEmail } from '../validation/email-format.util';

/**
 * The account-dimension key has to fold exactly the way the service folds it.
 *
 * The per-account budgets exist because the per-IP ones cannot stop a
 * distributed attack aimed at ONE address. That only holds while every request
 * reaching that address counts against the same bucket — so any difference
 * between how the limiter keys an address and how the service resolves it is a
 * way out of the budget, not a cosmetic mismatch.
 *
 * The keys were trimmed and lowercased; the services use `normalizeEmail`,
 * which also strips invisible characters and applies NFKC. Both variants below
 * satisfy `@IsEmail`, so both reach the service, and the service mails the same
 * real person for each — while each landed in a bucket of its own.
 */
describe('account-dimension rate-limit keys', () => {
  const guard = new RateLimitPolicyGuard({} as any, {} as any);
  // `identifierFor` is the unit under test; it is private by design.
  const keyFor = (body: any): string | null =>
    (guard as any).identifierFor('auth.signup.account', { body });

  const TARGET = 'victim@example.edu';

  // Same inbox, written four ways that all pass validation.
  const SAME_INBOX = [
    TARGET,
    'Victim@Example.EDU', // case
    '  victim@example.edu  ', // whitespace
    'ｖictim@example.edu', // fullwidth v — folds under NFKC
    'victim​@example.edu', // zero-width space — stripped
  ];

  it('folds every spelling of one address onto a single bucket', () => {
    const keys = new Set(SAME_INBOX.map((raw) => keyFor({ email: raw })));
    expect(keys).toEqual(new Set([TARGET]));
  });

  it('agrees exactly with the normalisation the services use', () => {
    for (const raw of SAME_INBOX) {
      expect(keyFor({ email: raw })).toBe(normalizeEmail(raw));
    }
  });

  it('still separates genuinely different addresses', () => {
    // The fold must not be so aggressive that two real inboxes share a budget —
    // that would let one person lock another out.
    expect(keyFor({ email: 'a@example.edu' })).not.toBe(
      keyFor({ email: 'b@example.edu' }),
    );
    // Plus-addressing is a different inbox to some providers and the same to
    // others; the services do not fold it, so neither may this.
    expect(keyFor({ email: 'a+1@example.edu' })).not.toBe(
      keyFor({ email: 'a@example.edu' }),
    );
  });

  it('reads `identifier` as well as `email`, for the login shape', () => {
    expect(keyFor({ identifier: 'Victim@Example.EDU' })).toBe(TARGET);
  });

  it('returns null when there is nothing to key on', () => {
    expect(keyFor({})).toBeNull();
    expect(keyFor({ email: '   ' })).toBeNull();
    expect(keyFor({ email: 42 })).toBeNull();
  });

  it('keys the login budget the same way', () => {
    // The controller spends this budget on failure and the guard checks it on
    // the way in; both go through this function, so a caller cannot get a fresh
    // login budget by varying the address they type.
    const keys = new Set(
      SAME_INBOX.map((raw) => loginAccountKey({ body: { identifier: raw } })),
    );
    expect(keys).toEqual(new Set([TARGET]));
  });

  it('leaves usernames alone beyond trim and lowercase', () => {
    // The login identifier may be a username, which must still key sensibly.
    expect(loginAccountKey({ body: { identifier: '  Alice_01  ' } })).toBe('alice_01');
    expect(loginAccountKey({ body: { identifier: '' } })).toBeNull();
    expect(loginAccountKey({ body: {} })).toBeNull();
  });
});
