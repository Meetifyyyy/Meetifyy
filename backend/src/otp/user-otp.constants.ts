/**
 * One-time-code policy for the account-deletion lifecycle.
 *
 * Every value here is enforced server-side. The client is told only what it
 * needs to render a countdown; none of it is trusted on the way back in.
 */

/** Codes are six digits, matching the signup and admin codes users already see. */
export const OTP_LENGTH = 6;

/** How long a code stays valid. Short enough to limit exposure of a mailbox. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Wrong guesses allowed against a single code before it is burned.
 *
 * Five attempts against a six-digit code is a 1-in-200,000 chance per code, and
 * the rate limits below cap how many codes an attacker can cause to exist.
 */
export const OTP_MAX_ATTEMPTS = 5;

/** Minimum gap between two send requests for the same user and purpose. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Codes a single user may request per purpose per hour. */
export const OTP_SEND_LIMIT_PER_HOUR = 5;

/**
 * Verification attempts allowed per IP per 15 minutes.
 *
 * Sits on top of the per-code attempt ceiling: that one stops guessing at a
 * single code, this one stops an attacker cycling through many codes (or many
 * accounts) from one place.
 */
export const OTP_VERIFY_LIMIT_PER_IP = 30;
export const OTP_VERIFY_IP_WINDOW_SEC = 15 * 60;
