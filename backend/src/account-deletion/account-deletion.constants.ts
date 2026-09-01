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

/**
 * Interactive-transaction budget for one account's purge.
 *
 * Prisma's default is 5 seconds, which a purge cannot meet: it issues roughly
 * thirty-five sequential statements — posts, activities, communities, comments,
 * campus events, match sessions, support tickets and every relational table —
 * and against a pooled remote database each of those carries a network
 * round-trip. The default silently held right up until the work ran against a
 * real database, where the transaction expired mid-flight and the purge failed
 * with "Transaction not found"; a mocked `$transaction` cannot reproduce that,
 * because it just calls the callback.
 *
 * Generous rather than tight on purpose. The transaction touches only one
 * user's rows, the sweep runs it for at most `PURGE_BATCH_SIZE` accounts one at
 * a time, and a purge that times out is retried anyway — so the cost of being
 * wrong upward is a slightly longer lock on rows nobody else is reading, while
 * the cost of being wrong downward is that permanent deletion never completes.
 */
export const PURGE_TRANSACTION_TIMEOUT_MS = 120_000;

/** How long to wait for a connection from the pool before giving up. */
export const PURGE_TRANSACTION_MAX_WAIT_MS = 15_000;
