/** BullMQ queue for the ranking precompute jobs (stage 2 of personalisation). */
export const RANKING_QUEUE = 'ranking';

/** Recomputes `UserAffinity` for every recently active user. */
export const JOB_AFFINITY_REBUILD = 'affinity-rebuild';

/** How often affinity is rebuilt. Interaction strength changes slowly; a feed
 *  that learns about a new friend within six hours is fresh enough, and the
 *  job's cost is paid four times a day rather than on every request. */
export const AFFINITY_REBUILD_MS = 6 * 60 * 60 * 1000;

/** Interactions older than this no longer count. */
export const AFFINITY_WINDOW_DAYS = 30;

/** An interaction loses half its weight every this many days, so last week's
 *  conversations outweigh last month's. */
export const AFFINITY_HALF_LIFE_DAYS = 14;

/** Rows kept per user: the people they interact with most. */
export const AFFINITY_TOP_N = 50;

/** Users recomputed per transaction. */
export const AFFINITY_BATCH_SIZE = 200;
