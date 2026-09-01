/**
 * Who may obtain a session.
 *
 * Extracted and named because it is the security-critical line in the sign-in
 * path and it is genuinely subtle: two of the four restricted states are
 * deliberately allowed through, and the reasons are opposite to the intuition
 * that "restricted means locked out".
 *
 *   ACTIVE            — obviously.
 *   SUSPENDED         — allowed. The account needs a working session to be told
 *                       what happened and to request a review. Every route
 *                       other than that flow is refused by `JwtGuard`.
 *   PENDING_DELETION  — allowed, and this is the whole point of the 30-day
 *                       window. The owner has to be able to sign back in and
 *                       change their mind; refusing them here would make the
 *                       recovery screen unreachable. `JwtGuard` then refuses
 *                       everything except profile sync and the recovery flow.
 *   BANNED            — refused. Terminal, and not appealable through the app.
 *   DELETED           — refused. The account is gone.
 *
 * The `deletedAt` clause is the one that has already bitten once: that column
 * is stamped the moment deletion is REQUESTED, because it is what hides the
 * account from every other user's queries. A bare `if (row.deletedAt) throw`
 * therefore locks the owner out of the only screen that can undo it.
 */
export interface SignInEligibilityInput {
  accountStatus: string | null | undefined;
  deletedAt: Date | string | null | undefined;
}

export type SignInDecision =
  { allowed: true } | { allowed: false; reason: 'DELETED' | 'BANNED' };

export function resolveSignInEligibility(
  row: SignInEligibilityInput,
): SignInDecision {
  const status = row.accountStatus;

  if (status === 'DELETED') return { allowed: false, reason: 'DELETED' };

  // Stamped at REQUEST time, so it must not stand alone — see above.
  if (row.deletedAt && status !== 'PENDING_DELETION') {
    return { allowed: false, reason: 'DELETED' };
  }

  if (status === 'BANNED') return { allowed: false, reason: 'BANNED' };

  return { allowed: true };
}
