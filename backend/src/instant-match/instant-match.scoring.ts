/**
 * Weighted compatibility scoring for Instant Match.
 *
 * The activity (the user's first/main category) is the *only* hard
 * requirement, and it is enforced by the candidate query — not here. Every
 * other signal is a preference: it moves the ranking, but it can never
 * disqualify a pairing on its own. That is deliberate. The previous scorer
 * ran behind an equality filter on campus *and* time preference, so a
 * perfect study partner one building over was invisible; and because a
 * missing signal scored 0, withholding GPS looked identical to being two
 * kilometres away.
 *
 * Two rules keep that from coming back:
 *
 *  1. **Unknown is neutral, not bad.** When either side omits a signal the
 *     factor returns NEUTRAL rather than 0, so nobody is punished for
 *     declining a location prompt.
 *  2. **Every factor is bounded and weighted.** The result is a 0–100
 *     compatibility score whose components are individually inspectable,
 *     which is what makes the relaxation ladder in the service meaningful.
 */

export interface QueueEntryContext {
  campus?: string | null;
  activity?: string | null;
  timePreference?: string | null;
  area?: string | null;
  optionalDetail?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  interests?: string[];
  course?: string | null;
  branch?: string | null;
  currentYear?: number | null;
  /** ms epoch — how long this side has been waiting. */
  joinedAt?: number | null;
  /** Number of prior conversations between the two users, if known. */
  priorConversations?: number | null;
}

/** A factor with nothing to go on contributes neither credit nor penalty. */
const NEUTRAL = 0.5;

/**
 * Weights sum to 100 so a score reads directly as a percentage. Ordered by
 * how strongly each signal actually predicts a meet-up happening: sharing a
 * campus and a time window matters far more than sharing a hobby tag.
 */
export const MATCH_WEIGHTS = {
  campus: 20,
  timePreference: 16,
  area: 14,
  proximity: 12,
  interests: 16,
  detail: 8,
  community: 8,
  history: 6,
} as const;

export type MatchFactor = keyof typeof MATCH_WEIGHTS;

export type ScoreBreakdown = Record<MatchFactor, number>;

export interface MatchScore {
  /** 0–100 weighted compatibility. */
  score: number;
  /** Per-factor 0–1 values, before weighting. Logged on every pairing so a
   *  surprising match can be explained rather than guessed at. */
  breakdown: ScoreBreakdown;
}

const TOTAL_WEIGHT = Object.values(MATCH_WEIGHTS).reduce((s, w) => s + w, 0);

// ─── Individual factors ───────────────────────────────────────────────────────

function haversineDistanceKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function norm(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function scoreCampus(a: QueueEntryContext, b: QueueEntryContext): number {
  const x = norm(a.campus);
  const y = norm(b.campus);
  if (!x || !y) return NEUTRAL;
  // A different campus is a real cost — but a survivable one, so that a lone
  // user on a small campus still gets matched rather than waiting forever.
  return x === y ? 1 : 0.15;
}

/**
 * "now" and "30min" overlap in practice; "today" is a different kind of plan.
 * Scored as a distance on that ladder rather than as equality, so a 30-minute
 * gap never blocks a pairing the way the old equality filter did.
 */
const TIME_ORDER: Record<string, number> = { now: 0, '30min': 1, today: 2 };

function scoreTimePreference(a: QueueEntryContext, b: QueueEntryContext): number {
  const x = norm(a.timePreference);
  const y = norm(b.timePreference);
  if (!x || !y) return NEUTRAL;
  const ix = TIME_ORDER[x];
  const iy = TIME_ORDER[y];
  if (ix === undefined || iy === undefined) return x === y ? 1 : NEUTRAL;
  const gap = Math.abs(ix - iy);
  if (gap === 0) return 1;
  if (gap === 1) return 0.6;
  return 0.25;
}

function scoreArea(a: QueueEntryContext, b: QueueEntryContext): number {
  const x = norm(a.area);
  const y = norm(b.area);
  if (!x || !y) return NEUTRAL;
  if (x === y) return 1;
  // Both named a spot and they differ: mildly worse than not knowing, since
  // on one campus any two areas are a short walk apart.
  return 0.35;
}

/** Smooth decay rather than the old three-step cliff, so 310 m does not
 *  score the same as 30 km. */
function scoreProximity(a: QueueEntryContext, b: QueueEntryContext): number {
  if (a.latitude == null || a.longitude == null) return NEUTRAL;
  if (b.latitude == null || b.longitude == null) return NEUTRAL;

  const km = haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
  if (!Number.isFinite(km)) return NEUTRAL;
  if (km <= 0.1) return 1;
  // Half-life of roughly 1 km, floored so distance can never zero out an
  // otherwise excellent match.
  const decayed = Math.exp(-(km - 0.1) / 1.4);
  return Math.max(0.1, Math.min(1, decayed));
}

function tokenize(value: string | null | undefined): Set<string> {
  const n = norm(value);
  if (!n) return new Set();
  return new Set(n.split(/[^a-z0-9]+/i).filter((t) => t.length > 2));
}

/** Jaccard over lowercased tags — rewards genuine overlap rather than the
 *  old all-or-nothing "shares at least one". */
function scoreInterests(a: QueueEntryContext, b: QueueEntryContext): number {
  const mine = new Set((a.interests ?? []).map((i) => String(i).trim().toLowerCase()).filter(Boolean));
  const theirs = new Set((b.interests ?? []).map((i) => String(i).trim().toLowerCase()).filter(Boolean));
  if (mine.size === 0 || theirs.size === 0) return NEUTRAL;

  let shared = 0;
  for (const tag of mine) if (theirs.has(tag)) shared += 1;
  if (shared === 0) return 0.2;

  const union = mine.size + theirs.size - shared;
  // Blend Jaccard with a saturating count so two people sharing 3 of 30 tags
  // still read as compatible.
  const jaccard = shared / union;
  const saturating = Math.min(1, shared / 3);
  return Math.max(0.25, Math.min(1, 0.5 * jaccard + 0.5 * saturating));
}

function scoreDetail(a: QueueEntryContext, b: QueueEntryContext): number {
  const x = norm(a.optionalDetail);
  const y = norm(b.optionalDetail);
  if (!x || !y) return NEUTRAL;
  if (x === y) return 1;

  const tx = tokenize(x);
  const ty = tokenize(y);
  if (tx.size === 0 || ty.size === 0) return NEUTRAL;

  let shared = 0;
  for (const t of tx) if (ty.has(t)) shared += 1;
  if (shared === 0) return 0.25;
  return Math.min(1, 0.4 + 0.6 * (shared / Math.min(tx.size, ty.size)));
}

/** College/community relevance: same course and branch beats same course,
 *  and a neighbouring year beats none of the above. */
function scoreCommunity(a: QueueEntryContext, b: QueueEntryContext): number {
  const parts: number[] = [];

  const courseA = norm(a.course);
  const courseB = norm(b.course);
  if (courseA && courseB) parts.push(courseA === courseB ? 1 : 0.2);

  const branchA = norm(a.branch);
  const branchB = norm(b.branch);
  if (branchA && branchB) parts.push(branchA === branchB ? 1 : 0.2);

  if (a.currentYear != null && b.currentYear != null) {
    const gap = Math.abs(a.currentYear - b.currentYear);
    parts.push(gap === 0 ? 1 : gap === 1 ? 0.6 : 0.25);
  }

  if (parts.length === 0) return NEUTRAL;
  return parts.reduce((s, p) => s + p, 0) / parts.length;
}

/**
 * Interaction history. People who have talked before are a slightly safer
 * pairing, but Instant Match exists to widen a circle — so this is the
 * lightest weight in the table and never dominates.
 */
function scoreHistory(a: QueueEntryContext, b: QueueEntryContext): number {
  const prior = a.priorConversations ?? b.priorConversations ?? null;
  if (prior == null) return NEUTRAL;
  if (prior <= 0) return NEUTRAL;
  return Math.min(1, 0.6 + 0.2 * prior);
}

// ─── Aggregate ────────────────────────────────────────────────────────────────

/**
 * Full weighted compatibility with a per-factor breakdown. Symmetric: the
 * pair scores the same regardless of who joined the queue first.
 */
export function computeCompatibility(
  a: QueueEntryContext,
  b: QueueEntryContext,
): MatchScore {
  const breakdown: ScoreBreakdown = {
    campus: scoreCampus(a, b),
    timePreference: scoreTimePreference(a, b),
    area: scoreArea(a, b),
    proximity: scoreProximity(a, b),
    interests: scoreInterests(a, b),
    detail: scoreDetail(a, b),
    community: scoreCommunity(a, b),
    history: scoreHistory(a, b),
  };

  let weighted = 0;
  for (const key of Object.keys(MATCH_WEIGHTS) as MatchFactor[]) {
    weighted += breakdown[key] * MATCH_WEIGHTS[key];
  }

  return {
    score: Math.round((weighted / TOTAL_WEIGHT) * 1000) / 10,
    breakdown,
  };
}

/** Convenience wrapper for callers that only need the number. */
export function computeMatchScore(a: QueueEntryContext, b: QueueEntryContext): number {
  return computeCompatibility(a, b).score;
}

/**
 * The compatibility floor a candidate must clear, given how long the searcher
 * has already waited.
 *
 * This is the relaxation ladder: hold out for a genuinely good partner at
 * first, then progressively accept a more compromised one rather than leave
 * someone searching indefinitely. It only ever relaxes *preferences* — the
 * activity match is enforced by the query and is never traded away.
 */
export const MATCH_THRESHOLD_START = 62;
export const MATCH_THRESHOLD_FLOOR = 0;
/** Wait after which any same-activity partner is better than none. */
export const MATCH_RELAX_FULL_MS = 3 * 60 * 1000;

export function relaxedThreshold(waitedMs: number): number {
  if (!Number.isFinite(waitedMs) || waitedMs <= 0) return MATCH_THRESHOLD_START;
  const progress = Math.min(1, waitedMs / MATCH_RELAX_FULL_MS);
  const span = MATCH_THRESHOLD_START - MATCH_THRESHOLD_FLOOR;
  return MATCH_THRESHOLD_START - span * progress;
}
