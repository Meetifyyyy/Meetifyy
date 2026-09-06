/**
 * The signals Instant Match ranks on.
 *
 * Each one is an independent function of the two sides plus whatever
 * relationship data was fetched for the pair. Adding a signal is adding an
 * entry to `SIGNALS` and a weight to `BASE_WEIGHTS` — the engine, the
 * explainer, the selection step and the tests all read the registry, so
 * nothing else has to be touched.
 *
 * The contract every signal keeps:
 *
 *  - Return `null` when there is nothing to go on. Not 0.5, and certainly not
 *    0. A signal with no evidence is excluded from the weighted mean *and*
 *    from the confidence calculation, which is what lets a sparse profile and
 *    a complete one produce comparable scores. Returning a neutral number
 *    instead silently spends that signal's weight on a coin flip.
 *  - Return 0..1 otherwise, where 0.5 means "known, and unremarkable".
 *  - Be symmetric. `f(a, b) === f(b, a)`, always: the same two people must
 *    score the same regardless of who happened to search first, or the
 *    ranking depends on queue order.
 */

import { FEEDBACK, SignalKey } from './matching.config';

/** One side of a pairing: their queue request plus the profile behind it. */
export interface SideContext {
  campus?: string | null;
  activity?: string | null;
  timePreference?: string | null;
  area?: string | null;
  optionalDetail?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  interests?: string[] | null;
  course?: string | null;
  branch?: string | null;
  passingYear?: number | null;
  /** ms epoch — how long this side has been waiting. */
  joinedAt?: number | null;
  /** Community ids this user belongs to, when they were loaded. `null` means
   *  "not fetched", which is different from "belongs to none". */
  communityIds?: string[] | null;
}

/** What has happened between these two people before. All counts are inside
 *  `FEEDBACK.windowMs`; anything older has already decayed out. */
export interface PairFeedback {
  /** Mutually accepted pairings. */
  accepted: number;
  /** Times the *viewer* passed on this candidate. */
  declinedByMe: number;
  /** Times this candidate passed on the viewer. */
  declinedByThem: number;
  /** Pairings neither side answered in time. */
  expired: number;
  /** When the two were last put together at all, ms epoch. */
  lastPairedAt: number | null;
}

/** Follow edges between the two, when known. */
export interface PairSocial {
  /** The viewer follows the candidate. */
  following: boolean;
  /** The candidate follows the viewer. */
  followedBy: boolean;
}

export interface SignalInput {
  a: SideContext;
  b: SideContext;
  feedback?: PairFeedback | null;
  social?: PairSocial | null;
  /** Injected so recency is testable and every signal in one evaluation
   *  reads the same instant. */
  now: number;
}

export interface SignalDefinition {
  key: SignalKey;
  /** Shown in explanations; not used for scoring. */
  label: string;
  /** 0..1, or null when the pair gives nothing to judge on. */
  evaluate(input: SignalInput): number | null;
  /** A short human reason, for the explain output. Optional. */
  describe?(input: SignalInput, value: number | null): string | undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function tags(list: string[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of list ?? []) {
    const n = norm(String(raw));
    if (n) out.add(n);
  }
  return out;
}

function tokenize(value: string | null | undefined): Set<string> {
  const n = norm(value);
  if (!n) return new Set();
  return new Set(n.split(/[^a-z0-9]+/i).filter((t) => t.length > 2));
}

function overlap(x: Set<string>, y: Set<string>): number {
  let shared = 0;
  for (const item of x) if (y.has(item)) shared += 1;
  return shared;
}

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
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

/** Reads a "worse each time" ladder. Index 0 is the first occurrence; the
 *  last entry repeats for everything beyond it. */
function ladder(steps: readonly number[], count: number): number | null {
  if (count <= 0) return null;
  return steps[Math.min(count, steps.length) - 1];
}

/** "now" and "30min" are the same plan in practice; "today" is a different
 *  kind of plan. Scored as a distance on that ladder, never as equality. */
const TIME_ORDER: Record<string, 0 | 1 | 2> = { now: 0, '30min': 1, today: 2 };

export function timeRank(value: string | null | undefined): 0 | 1 | 2 | null {
  const n = norm(value);
  if (!n) return null;
  const rank = TIME_ORDER[n];
  return rank === undefined ? null : rank;
}

// ─── The registry ────────────────────────────────────────────────────────────

export const SIGNALS: readonly SignalDefinition[] = [
  {
    key: 'campus',
    label: 'Same campus',
    evaluate({ a, b }) {
      const x = norm(a.campus);
      const y = norm(b.campus);
      if (!x || !y) return null;
      // A different campus is a real cost but a survivable one, so a lone
      // user on a small campus still gets matched rather than waiting out
      // the queue's whole TTL.
      return x === y ? 1 : 0.15;
    },
  },

  {
    key: 'timePreference',
    label: 'When they want to meet',
    evaluate({ a, b }) {
      const x = timeRank(a.timePreference);
      const y = timeRank(b.timePreference);
      if (x === null || y === null) return null;
      const gap = Math.abs(x - y);
      if (gap === 0) return 1;
      if (gap === 1) return 0.6;
      return 0.25;
    },
  },

  {
    key: 'area',
    label: 'Campus area',
    evaluate({ a, b }) {
      const x = norm(a.area);
      const y = norm(b.area);
      if (!x || !y) return null;
      // Both named a spot and they differ: mildly worse than not knowing,
      // since on one campus any two areas are a short walk apart.
      return x === y ? 1 : 0.35;
    },
  },

  {
    key: 'proximity',
    label: 'How far apart',
    evaluate({ a, b }) {
      if (a.latitude == null || a.longitude == null) return null;
      if (b.latitude == null || b.longitude == null) return null;
      const km = haversineDistanceKm(
        a.latitude,
        a.longitude,
        b.latitude,
        b.longitude,
      );
      if (!Number.isFinite(km)) return null;
      if (km <= 0.1) return 1;
      // Half-life of roughly 1 km, floored so distance alone can never zero
      // out an otherwise excellent match.
      return Math.max(0.1, Math.min(1, Math.exp(-(km - 0.1) / 1.4)));
    },
    describe({ a, b }) {
      if (a.latitude == null || b.latitude == null) return undefined;
      if (a.longitude == null || b.longitude == null) return undefined;
      const km = haversineDistanceKm(
        a.latitude,
        a.longitude,
        b.latitude,
        b.longitude,
      );
      return Number.isFinite(km) ? `${km.toFixed(2)}km apart` : undefined;
    },
  },

  {
    key: 'interests',
    label: 'Shared interests',
    evaluate({ a, b }) {
      const mine = tags(a.interests);
      const theirs = tags(b.interests);
      if (mine.size === 0 || theirs.size === 0) return null;

      const shared = overlap(mine, theirs);
      if (shared === 0) return 0.2;
      const union = mine.size + theirs.size - shared;
      // Jaccard blended with a saturating count, so two people sharing 3 of
      // 30 tags still read as compatible rather than as 10% compatible.
      const jaccard = shared / union;
      const saturating = Math.min(1, shared / 3);
      return Math.max(0.25, Math.min(1, 0.5 * jaccard + 0.5 * saturating));
    },
  },

  {
    key: 'detail',
    label: 'What they wrote',
    evaluate({ a, b }) {
      const x = norm(a.optionalDetail);
      const y = norm(b.optionalDetail);
      if (!x || !y) return null;
      if (x === y) return 1;

      const tx = tokenize(x);
      const ty = tokenize(y);
      if (tx.size === 0 || ty.size === 0) return null;

      const shared = overlap(tx, ty);
      if (shared === 0) return 0.25;
      return Math.min(1, 0.4 + 0.6 * (shared / Math.min(tx.size, ty.size)));
    },
  },

  {
    key: 'community',
    label: 'Course, branch and year',
    evaluate({ a, b }) {
      const parts: number[] = [];

      const courseA = norm(a.course);
      const courseB = norm(b.course);
      if (courseA && courseB) parts.push(courseA === courseB ? 1 : 0.2);

      const branchA = norm(a.branch);
      const branchB = norm(b.branch);
      if (branchA && branchB) parts.push(branchA === branchB ? 1 : 0.2);

      if (a.passingYear != null && b.passingYear != null) {
        const gap = Math.abs(a.passingYear - b.passingYear);
        parts.push(gap === 0 ? 1 : gap === 1 ? 0.6 : 0.25);
      }

      if (parts.length === 0) return null;
      return parts.reduce((s, p) => s + p, 0) / parts.length;
    },
  },

  {
    key: 'network',
    label: 'Follow each other',
    evaluate({ social }) {
      if (!social) return null;
      if (social.following && social.followedBy) return 1;
      if (social.following || social.followedBy) return 0.75;
      // Two strangers is the normal case for this feature and says nothing
      // about compatibility — no evidence rather than a penalty.
      return null;
    },
  },

  {
    key: 'groups',
    label: 'Shared communities',
    evaluate({ a, b }) {
      // `null` means the memberships were never loaded; an empty array means
      // this user genuinely belongs to none. Only the second is comparable,
      // and only when both sides have something to compare.
      if (!Array.isArray(a.communityIds) || !Array.isArray(b.communityIds)) {
        return null;
      }
      const mine = new Set(a.communityIds);
      const theirs = new Set(b.communityIds);
      if (mine.size === 0 || theirs.size === 0) return null;

      const shared = overlap(mine, theirs);
      if (shared === 0) return 0.35;
      return Math.min(1, 0.55 + 0.15 * shared);
    },
  },

  {
    key: 'familiarity',
    label: 'Matched before',
    evaluate({ feedback }) {
      if (!feedback || feedback.accepted <= 0) return null;
      return ladder(FEEDBACK.familiarity, feedback.accepted);
    },
    describe({ feedback }) {
      return feedback?.accepted
        ? `${feedback.accepted} previous match(es)`
        : undefined;
    },
  },

  {
    key: 'rapport',
    label: 'Passes between them',
    /**
     * The negative side of the feedback loop, and the reason a pass has to be
     * attributed. All three counts are read and the worst applies: being
     * passed on twice by someone you also passed on once is not a pairing
     * worth making, and taking the maximum of the three would let the mildest
     * signal hide the strongest.
     */
    evaluate({ feedback }) {
      if (!feedback) return null;
      const candidates = [
        ladder(FEEDBACK.declinedByMe, feedback.declinedByMe),
        ladder(FEEDBACK.declinedByThem, feedback.declinedByThem),
        ladder(FEEDBACK.expiredTogether, feedback.expired),
      ].filter((v): v is number => v !== null);

      if (candidates.length === 0) return null;
      return Math.min(...candidates);
    },
    describe({ feedback }) {
      if (!feedback) return undefined;
      const parts: string[] = [];
      if (feedback.declinedByMe) parts.push(`passed ×${feedback.declinedByMe}`);
      if (feedback.declinedByThem) {
        parts.push(`passed-on ×${feedback.declinedByThem}`);
      }
      if (feedback.expired) parts.push(`timed out ×${feedback.expired}`);
      return parts.length ? parts.join(', ') : undefined;
    },
  },

  {
    key: 'recency',
    label: 'How recently they were paired',
    /**
     * The repetition damper. Independent of the outcome: being handed the
     * same person twenty minutes after the last attempt reads as a broken
     * queue whether that attempt ended in a pass, a timeout or a chat.
     */
    evaluate({ feedback, now }) {
      const last = feedback?.lastPairedAt;
      if (last == null) return null;
      const age = now - last;
      if (!Number.isFinite(age) || age < 0) return null;
      for (const step of FEEDBACK.recency) {
        if (age <= step.withinMs) return step.value;
      }
      // Older than the last rung: long enough ago to carry no information.
      return null;
    },
  },
];

/** Signals by key, for the explainer and for tests that poke one directly. */
export const SIGNALS_BY_KEY: ReadonlyMap<SignalKey, SignalDefinition> = new Map(
  SIGNALS.map((s) => [s.key, s]),
);

/**
 * Whether this pairing should not be offered at all right now.
 *
 * Deliberately tiny, and deliberately separate from scoring: a skip is a
 * product decision ("we have asked three times, stop asking"), not a low
 * score, and conflating the two makes both harder to reason about. It is
 * bounded by `hardSkipMs` — the block list is the only permanent exclusion,
 * and it is applied before any of this runs.
 */
export function isHardSkipped(
  feedback: PairFeedback | null | undefined,
  now: number,
): boolean {
  if (!feedback) return false;
  if (feedback.declinedByMe < FEEDBACK.hardSkipAfterPasses) return false;
  if (feedback.lastPairedAt == null) return true;
  return now - feedback.lastPairedAt <= FEEDBACK.hardSkipMs;
}
