/**
 * Decides whether an account has just BECOME verified, as opposed to simply
 * being verified.
 *
 * Extracted from the modal because it is the only part with a real decision in
 * it, and because getting it wrong is embarrassing in a specific way: the naive
 * rule ("show it when the account is verified") would have congratulated every
 * already-verified user the first time they loaded the build — thousands of
 * people told they had just achieved something they did months ago.
 *
 * The rule is therefore about the TRANSITION. The first observation for an
 * account is recorded silently, so an account that was already verified before
 * this existed never celebrates; only a recorded non-verified status followed
 * by a verified one does.
 */

export const VERIFIED = 'VERIFIED';

/**
 * @param {string|null|undefined} previous - last status this browser recorded
 *   for the account, or null if it has never seen one.
 * @param {string|null|undefined} current - the status the server reports now.
 * @returns {{ celebrate: boolean, nextStored: string|null }}
 *   `nextStored` is null when there is nothing new to record.
 */
export function resolveVerificationCelebration(previous, current) {
  if (!current) return { celebrate: false, nextStored: null };

  const celebrate = current === VERIFIED && !!previous && previous !== VERIFIED;
  const nextStored = previous === current ? null : current;

  return { celebrate, nextStored };
}
