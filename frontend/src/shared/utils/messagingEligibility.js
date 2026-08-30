/**
 * The client's mirror of the server's messaging verification policy.
 *
 * This is presentation only. The backend refuses ineligible sends on its own
 * (see VerificationAccessService), so nothing here is a security boundary —
 * its job is to stop the app from offering an affordance the server will
 * reject, and to explain why in the composer instead of a bounced message.
 */

/** VERIFIED is the only eligible state — mirrors VerificationAccessService. */
export const isMessagingEligibleStatus = (status) => status === 'VERIFIED';

/**
 * Shown in place of the composer. Deliberately the same sentence whether the
 * other person is unverified, pending, rejected or awaiting resubmission: the
 * viewer is not entitled to know which, and one wording keeps the reason from
 * leaking through a diff in copy.
 */
export const MESSAGING_UNAVAILABLE_TEXT = 'This user is not available for messaging.';

/**
 * Shown when it is the viewer's own account that is not eligible. Matches the
 * wording the backend returns for `@VerifiedOnly()` so the two never disagree.
 */
export const MESSAGING_SELF_UNVERIFIED_TEXT =
  'Verify your account to send messages.';

/**
 * The verification-gated surfaces whose cached data must be dropped the moment
 * the viewer stops being eligible.
 *
 * Locking a page only hides it. These caches — React Query's, and the
 * IndexedDB mirror behind the campus directory — outlive the lock and would
 * otherwise keep serving campus content to an account that just lost access,
 * including across a reload.
 */
export const VERIFICATION_GATED_QUERY_KEYS = [
  ['campusUsers'],
  ['directory'],
  ['campus-events'],
  ['communities', 'campus'],
];

/**
 * Which composer state a conversation should render, and why.
 *
 * The precedence matters and was duplicated across the DM and group chat areas,
 * free to drift: a block is a more specific fact than a verification lapse and
 * must keep its own wording, and a membership problem is more specific still.
 * Telling someone "this user is not available for messaging" when they are the
 * one who blocked them — or when their own account is unverified — sends them
 * to the wrong fix.
 *
 * Returns `{ disabled, reason }`. `reason` is null exactly when `disabled` is
 * false. This decides presentation only; the server refuses ineligible sends
 * regardless of what this returns.
 */
export function resolveComposerState({
  isBlockedByMe = false,
  isBlocked = false,
  membershipReason = null,
  canSend = true,
  verificationReason = null,
} = {}) {
  if (isBlockedByMe) {
    return {
      disabled: true,
      reason: 'You blocked this user. Unblock them to continue messaging.',
    };
  }
  if (isBlocked) {
    // Deliberately neutral, and identical for "they blocked me" and any other
    // closed thread: it must not disclose which.
    return {
      disabled: true,
      reason: 'You can no longer send messages to this user.',
    };
  }
  if (membershipReason) {
    return { disabled: true, reason: membershipReason };
  }
  if (!canSend) {
    return {
      disabled: true,
      reason: verificationReason || MESSAGING_UNAVAILABLE_TEXT,
    };
  }
  return { disabled: false, reason: null };
}
