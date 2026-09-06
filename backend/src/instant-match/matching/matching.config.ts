/**
 * Instant Match ranking — every tunable number in one place.
 *
 * Literals, deliberately not environment variables: a weight that can be
 * changed per environment is a weight nobody can reason about from the code,
 * and "why did dev pair those two?" becomes unanswerable. Changing a number
 * here is a reviewed commit, the same rule `rate-limit.config.ts` follows.
 *
 * Three things live here:
 *
 *  1. `BASE_WEIGHTS` — the relative importance of each signal.
 *  2. `INTENT_PROFILES` — multipliers applied on top, so what matters depends
 *     on what the pair is actually trying to do.
 *  3. The selection, feedback and threshold constants the ranker reads.
 *
 * Adding a signal means adding one weight here and one entry in
 * `signals.ts`. Nothing else in the pipeline knows the list.
 */

/** The score a pair gets when nothing at all is known about them. Not 0:
 *  two strangers with empty profiles are unknown, not incompatible. */
export const MATCH_PRIOR = 0.5;

/**
 * How hard a partially-evidenced score is pulled back toward the prior.
 *
 * `confidence = coverage ** SHRINK_EXPONENT`, where coverage is the share of
 * total weight that had anything to go on. Without this, one lucky signal on
 * an otherwise empty profile produced the same 95 as a pair that agreed on
 * everything — the number stopped meaning anything across candidates. Below 1
 * the curve is generous: half the evidence still buys ~62% of the confidence.
 */
export const SHRINK_EXPONENT = 0.7;

/**
 * No signal may be worth more than this share of the total weight.
 *
 * Enforced by `resolveWeights`, not by hand-checking the table, because the
 * intent multipliers below can push a weight past the cap even when the base
 * table is balanced. A single dominant parameter is how a "weighted" ranker
 * quietly turns back into an equality filter.
 */
export const MAX_WEIGHT_SHARE = 0.2;

export const SIGNAL_KEYS = [
  'campus',
  'timePreference',
  'area',
  'proximity',
  'interests',
  'detail',
  'community',
  'network',
  'groups',
  'familiarity',
  'rapport',
  'recency',
] as const;

export type SignalKey = (typeof SIGNAL_KEYS)[number];

/**
 * Base importance, summing to 100 so a weight reads as a percentage.
 *
 * Ordered by how strongly each actually predicts a meet-up happening: being
 * on the same campus at a compatible time beats sharing a hobby tag, and both
 * beat having followed each other. The behavioural signals (`rapport`,
 * `familiarity`, `recency`) carry real weight because a candidate this user
 * has already passed on twice is a worse suggestion than a stranger, however
 * well their profile reads.
 */
export const BASE_WEIGHTS: Record<SignalKey, number> = {
  campus: 16,
  timePreference: 12,
  interests: 13,
  area: 9,
  proximity: 9,
  rapport: 9,
  community: 7,
  familiarity: 6,
  detail: 5,
  network: 5,
  groups: 5,
  recency: 4,
};

/** Multipliers applied to `BASE_WEIGHTS`. Absent key = unchanged (×1). */
export type WeightProfile = Partial<Record<SignalKey, number>>;

/**
 * What the pair is trying to do, derived from the pair itself rather than
 * from one side — see `resolveIntent`. Scoring has to stay symmetric (the
 * same two people must score the same regardless of who searched first), so
 * "intent" is a property of the pairing, not of the searcher.
 */
export interface MatchIntent {
  /** 0 = someone wants to meet now, 2 = sometime today. */
  urgency: 0 | 1 | 2;
  /** The activity both sides queued for; it is the one hard requirement. */
  activity: string | null;
}

/**
 * Urgency changes what matters. Meeting *now* is a logistics problem — where
 * you are and when you are free decide whether it happens at all, and a
 * shared taste in films does not. A plan for later in the day is the opposite:
 * there is time to walk across campus, so who the person is matters more than
 * where they are standing.
 */
export const URGENCY_PROFILES: Record<0 | 1 | 2, WeightProfile> = {
  0: {
    proximity: 1.5,
    area: 1.4,
    timePreference: 1.3,
    interests: 0.8,
    community: 0.85,
    groups: 0.85,
  },
  1: { proximity: 1.15, area: 1.15, timePreference: 1.1 },
  2: {
    proximity: 0.6,
    area: 0.7,
    interests: 1.25,
    community: 1.2,
    groups: 1.2,
    network: 1.15,
  },
};

/**
 * And so does the activity. Sitting down to study with someone is a question
 * about their course; going for a walk is a question about where they are;
 * coffee is a question about whether you will have anything to say.
 *
 * Keyed by activity id — the same ids as `instant-match.constants.ts`. An
 * activity with no entry simply uses the base table.
 */
export const ACTIVITY_PROFILES: Record<string, WeightProfile> = {
  study: { community: 1.5, detail: 1.5, area: 1.2, interests: 0.85 },
  coding: { community: 1.35, detail: 1.5, interests: 1.1 },
  library: { community: 1.3, detail: 1.3, area: 1.3 },
  sports: { proximity: 1.35, area: 1.3, detail: 1.25, community: 0.8 },
  walk: { proximity: 1.4, area: 1.25, community: 0.8 },
  coffee: { interests: 1.3, network: 1.2, community: 0.85 },
  food: { interests: 1.2, area: 1.2, community: 0.85 },
  chat: {
    interests: 1.4,
    network: 1.25,
    groups: 1.2,
    community: 0.8,
    proximity: 0.85,
  },
  gaming: { interests: 1.4, detail: 1.2, community: 0.85 },
  movie: { interests: 1.35, area: 1.15, community: 0.85 },
  event: { interests: 1.2, groups: 1.3, network: 1.15 },
};

/**
 * Behavioural feedback.
 *
 * The window is finite on purpose. A pass says "not right now", not "never" —
 * so its effect decays out of the window rather than following someone
 * around, and only the hard-skip below stops a pairing outright.
 */
export const FEEDBACK = {
  /** How far back declines, expiries and prior matches are read. */
  windowMs: 30 * 24 * 60 * 60 * 1000,

  /**
   * Passing on someone drops their rank for the person who passed, harder
   * each time. Index = number of passes; the last entry repeats.
   */
  declinedByMe: [0.35, 0.15, 0.05],
  /** Being passed *on* is a weaker signal — they may simply have been away. */
  declinedByThem: [0.45, 0.28, 0.12],
  /** Nobody answered. The weakest negative of the three: it is usually a
   *  phone in a pocket, not a decision. */
  expiredTogether: [0.5, 0.35, 0.25],

  /**
   * After this many passes inside the window, stop offering the pairing
   * altogether for `hardSkipMs` — at that point re-ranking them is noise.
   * Bounded, never permanent: the product's own block list is the only
   * permanent exclusion, and it is applied separately.
   */
  hardSkipAfterPasses: 3,
  hardSkipMs: 7 * 24 * 60 * 60 * 1000,

  /**
   * Prior *successful* pairings. One is a mild positive — you got on. Beyond
   * that it inverts: Instant Match exists to widen a circle, and a queue that
   * keeps reintroducing the same person has stopped doing its job.
   */
  familiarity: [0.65, 0.45, 0.25],

  /**
   * How recently the pair was put together at all, in ms → score. Anything
   * older than the last rung is no evidence rather than a value.
   *
   * Every rung sits at or below the prior, and that is the point: this signal
   * is a damper, never a bonus. A rung above 0.5 would mean "you two were
   * paired last week" counted *for* the pairing, which is precisely the
   * repetition it exists to suppress.
   */
  recency: [
    { withinMs: 60 * 60 * 1000, value: 0.1 },
    { withinMs: 6 * 60 * 60 * 1000, value: 0.25 },
    { withinMs: 24 * 60 * 60 * 1000, value: 0.4 },
    { withinMs: 7 * 24 * 60 * 60 * 1000, value: 0.45 },
  ],
} as const;

/**
 * Candidate selection: how the ranked list becomes an order to try.
 *
 * Pure score order is repeatable in the bad sense — the same person is
 * offered the same partner every sweep, and two candidates a tenth of a point
 * apart are treated as if the difference were real. It is not: the score is
 * an estimate with a shrinkage term in it.
 */
export const SELECTION = {
  /** Scores within this many points of the leader are treated as tied. */
  tieBandPoints: 3,

  /**
   * How often to take a candidate from outside the leading band —
   * exploration. Without it the ranker only ever confirms what it already
   * believes, and a user sees one type of person forever.
   */
  exploreRate: 0.12,
  /** Exploration reaches this far below the leader, and no further: a
   *  long-shot is still supposed to be a plausible match. */
  exploreBandPoints: 14,

  /**
   * Inside a band, longer waits win more often — but only up to a point.
   *
   * Both halves matter. Without the weighting the draw ignores fairness; with
   * an unbounded one a ten-minute wait is twenty times likelier than a fresh
   * arrival, which turns the tie band back into a strict order and undoes the
   * diversification it exists for. Capped, the longest waiter is favoured
   * roughly four to one and the band stays a band.
   */
  waitWeightMs: 60 * 1000,
  waitWeightCap: 3,
} as const;

/**
 * The compatibility floor, relaxed by waiting.
 *
 * Unchanged in shape and value from the original ladder — it was right, and
 * "any same-activity partner beats nobody" is the correct end state for a
 * sparse campus queue. It is here so it is configurable alongside everything
 * else rather than buried in the scorer.
 */
export const THRESHOLD = {
  start: 62,
  floor: 0,
  relaxFullMs: 3 * 60 * 1000,
} as const;

/** How many waiting entries one join attempt ranks. */
export const CANDIDATE_SCAN_LIMIT = 200;
