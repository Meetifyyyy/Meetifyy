/**
 * The password rules, in one place.
 *
 * Signup and reset each carried their own copy of the limits, which is how they
 * came to disagree about whitespace: reset trimmed, signup did not, and a
 * password set on one screen could not be used on the other. Shared constants
 * mean the two screens cannot drift apart again.
 *
 * ── What is deliberately NOT here ──────────────────────────────────────────
 *
 * There is no character allowlist and no composition rule. Every printable
 * character is valid, spaces included, because a passphrase like
 * "correct horse battery staple" is a genuinely strong password and a rule that
 * bans spaces rejects it while permitting "Password1!". Forbidding characters
 * only shrinks the search space.
 *
 * The password is never altered on its way through — not trimmed, not
 * normalised, not truncated. What the user typed is what gets stored, so what
 * they type at sign-in matches it.
 */

/** Below this a password is too easy to guess to be worth accepting. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * An upper bound so a pathological input cannot be sent to the hasher.
 *
 * This is a real validation limit, not an input cap: the fields deliberately do
 * NOT set `maxLength`. An HTML `maxLength` silently truncates on paste, so a
 * generated password longer than the limit was quietly cut and stored short,
 * and the user was never told — the same class of bug as trimming, and just as
 * hard to diagnose from the login screen afterwards. Letting the value through
 * and failing it with a message means the user finds out.
 */
export const PASSWORD_MAX_LENGTH = 100;

/**
 * Why a password is unacceptable, or null when it is fine.
 *
 * Returns the message to show, so signup and reset word it identically.
 */
export function validatePassword(password) {
  const value = typeof password === 'string' ? password : '';
  if (!value) return 'Password is required.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Password can't exceed ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}
