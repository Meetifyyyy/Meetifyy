import { resolveSignInEligibility } from './sign-in-eligibility';

/**
 * Who may obtain a session.
 *
 * Two of the four restricted states are deliberately allowed through, for
 * reasons opposite to the intuition that "restricted means locked out" — so
 * each one is asserted explicitly rather than left to be re-derived by whoever
 * next edits this rule.
 */
describe('resolveSignInEligibility', () => {
  const row = (over: any = {}) => ({
    accountStatus: 'ACTIVE',
    deletedAt: null,
    ...over,
  });

  it('allows an active account', () => {
    expect(resolveSignInEligibility(row())).toEqual({ allowed: true });
  });

  it('allows a suspended account', () => {
    // It needs a working session to be told what happened and to appeal.
    // JwtGuard refuses every route other than that flow.
    expect(resolveSignInEligibility(row({ accountStatus: 'SUSPENDED' }))).toEqual(
      { allowed: true },
    );
  });

  it('allows an account inside its 30-day deletion window', () => {
    // The entire point of the window. Refusing here makes the recovery screen
    // unreachable — which is exactly what was happening.
    expect(
      resolveSignInEligibility(
        row({ accountStatus: 'PENDING_DELETION', deletedAt: new Date() }),
      ),
    ).toEqual({ allowed: true });
  });

  it('is not fooled by deletedAt alone', () => {
    // `deletedAt` is stamped at REQUEST time, because it is what hides the
    // account from everyone else's queries. A bare `if (deletedAt) throw`
    // therefore locks the owner out of the only screen that can undo it. This
    // is the regression that shipped once already.
    const pending = row({
      accountStatus: 'PENDING_DELETION',
      deletedAt: new Date(),
    });
    expect(pending.deletedAt).not.toBeNull();
    expect(resolveSignInEligibility(pending).allowed).toBe(true);
  });

  it('refuses a permanently deleted account', () => {
    expect(
      resolveSignInEligibility(
        row({ accountStatus: 'DELETED', deletedAt: new Date() }),
      ),
    ).toEqual({ allowed: false, reason: 'DELETED' });
  });

  it('refuses a banned account', () => {
    expect(resolveSignInEligibility(row({ accountStatus: 'BANNED' }))).toEqual({
      allowed: false,
      reason: 'BANNED',
    });
  });

  it('refuses a row stamped deletedAt in any state other than pending', () => {
    // Defence against a state that should not exist but would otherwise sign in.
    for (const accountStatus of ['ACTIVE', 'SUSPENDED']) {
      expect(
        resolveSignInEligibility(row({ accountStatus, deletedAt: new Date() })),
      ).toEqual({ allowed: false, reason: 'DELETED' });
    }
  });

  it('reports DELETED ahead of BANNED when both could apply', () => {
    // Terminal deletion is the stronger statement, and the message the user
    // gets should not imply an appeal is possible.
    expect(
      resolveSignInEligibility({
        accountStatus: 'DELETED',
        deletedAt: new Date(),
      }),
    ).toEqual({ allowed: false, reason: 'DELETED' });
  });
});
