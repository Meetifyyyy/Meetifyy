/**
 * Policy for the sensitive email operations (Settings → Email, Campus).
 *
 * Every value is enforced server-side, against the database clock. The client
 * is told only what it needs to render a date or a countdown.
 */

/**
 * The rolling cooldown after a completed change, per channel: exactly
 * 30 × 24 hours, not a calendar month. Kept in hours because that is how the
 * SQL that enforces it expresses it.
 */
export const EMAIL_CHANGE_COOLDOWN_HOURS = 30 * 24;
export const EMAIL_CHANGE_COOLDOWN_MS =
  EMAIL_CHANGE_COOLDOWN_HOURS * 60 * 60 * 1000;

/**
 * How long a reauthentication grant stays spendable. Long enough to type a new
 * address and the code sent to it (the code itself lives 10 minutes), short
 * enough that a session left open is not a standing licence.
 */
export const REAUTH_GRANT_TTL_MS = 10 * 60 * 1000;

/**
 * The window in which the auth.users trigger accepts the admin write of a new
 * sign-in email. It covers one Supabase admin call, so it is short; an intent
 * outlives it only as a marker for reconciliation.
 */
export const AUTH_EMAIL_INTENT_TTL_MS = 60 * 1000;

/** Error codes the clients key off. */
export const REAUTH_REQUIRED_CODE = 'reauth_required';
export const EMAIL_CHANGE_COOLDOWN_CODE = 'email_change_cooldown';
