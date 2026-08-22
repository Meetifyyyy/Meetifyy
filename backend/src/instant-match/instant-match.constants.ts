/**
 * Single source of truth for Instant Match domain vocabulary.
 *
 * The frontend mirrors these values in
 * `frontend/src/features/instant-match/constants/matchConstants.js`.
 * Anything the client sends is validated against these lists before it
 * reaches Prisma — the UI is never trusted to constrain the input.
 */

export const MATCH_ACTIVITIES = [
  'study', 'coding', 'sports', 'coffee', 'food', 'gaming',
  'walk', 'movie', 'event', 'chat', 'library', 'other',
] as const;

export type MatchActivity = (typeof MATCH_ACTIVITIES)[number];

export const OUTDOOR_ACTIVITIES: ReadonlySet<string> = new Set(['sports', 'walk']);

export const TIME_PREFERENCES = ['now', '30min', 'today'] as const;

export type TimePreference = (typeof TIME_PREFERENCES)[number];

export const CAMPUS_AREAS = [
  'library', 'cafeteria', 'hostel', 'academic_block',
  'sports_complex', 'main_gate', 'other',
] as const;

/** Accept-window in seconds, by activity category. */
export const ACCEPT_TIMER_INDOOR = 30;
export const ACCEPT_TIMER_OUTDOOR = 60;
export const ACCEPT_TIMER_TODAY = 90;

/** Grace period added to the server-side deadline so a client that
 *  responds on the final tick is not rejected by clock skew. */
export const ACCEPT_TIMER_GRACE_MS = 5_000;

/** How long a queue entry survives without being matched. */
export const QUEUE_TTL_MS = 30 * 60 * 1000;

/** Free-text `optionalDetail` limit — mirrors the input's maxLength. */
export const OPTIONAL_DETAIL_MAX = 60;

/** Campus label limit. Campus comes from the user's profile, but it
 *  arrives over the socket so it is bounded like any other input. */
export const CAMPUS_MAX = 120;

/** Sweep cadence for expiring stale queue entries and match sessions.
 *  Must be well under the shortest accept timer (30s) so a timed-out
 *  match is reconciled at roughly the moment the client's ring empties. */
export const EXPIRY_SWEEP_MS = 10_000;

/** Abuse limits, enforced per user on the gateway. */
export const RATE_LIMIT_JOIN = { points: 10, windowMs: 60_000 };
export const RATE_LIMIT_RESPOND = { points: 30, windowMs: 60_000 };

export function getAcceptTimerSecs(activity: string, timePreference: string): number {
  if (timePreference === 'today') return ACCEPT_TIMER_TODAY;
  return OUTDOOR_ACTIVITIES.has(activity) ? ACCEPT_TIMER_OUTDOOR : ACCEPT_TIMER_INDOOR;
}
