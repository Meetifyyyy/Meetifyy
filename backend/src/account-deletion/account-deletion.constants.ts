/**
 * Account-deletion lifecycle constants.
 *
 * Every duration here is measured server-side. Nothing in this flow is ever
 * derived from a client clock: the browser countdown is rendered from
 * `scheduledPurgeAt`, an absolute instant the server computed and stored, so a
 * device with a skewed clock can render a wrong number of days but can never
 * change when the account is actually eligible for purge.
 */

/** The recovery window a user gets after requesting deletion. */
export const RECOVERY_WINDOW_DAYS = 30;

export const RECOVERY_WINDOW_MS = RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const ACCOUNT_DELETION_QUEUE = 'account-deletion';

/** Repeatable sweep that purges every account whose window has expired. */
export const JOB_PURGE_SWEEP = 'purge-expired-accounts';

/**
 * How often the sweep runs. The deadline semantics are "eligible at
 * `scheduledPurgeAt`", not "deleted at exactly that instant", so a sweep
 * interval only ever delays a purge — it never shortens the 30 days.
 */
export const PURGE_SWEEP_MS = 15 * 60 * 1000;

/** Rows claimed per sweep, so one run can never hold a long transaction. */
export const PURGE_BATCH_SIZE = 25;

/**
 * How long a claim on a row is honoured before another worker may retake it.
 * A process that dies mid-purge leaves `purgeStartedAt` set; once it is this
 * old the row is considered abandoned and re-claimed. Purge steps are all
 * idempotent, so re-running a partially completed purge is safe.
 */
export const PURGE_LEASE_MS = 30 * 60 * 1000;

/**
 * Attempts before the worker stops retrying a row on its own. The row stays
 * PENDING_DELETION with `purgeLastError` set and surfaces in the admin
 * Account Deletion queue as failed, where it can be retried by hand. It is
 * never silently dropped.
 */
export const PURGE_MAX_ATTEMPTS = 5;

/** Machine-readable code the client keys the full-screen recovery gate off. */
export const PENDING_DELETION_ERROR_CODE = 'ACCOUNT_PENDING_DELETION';
