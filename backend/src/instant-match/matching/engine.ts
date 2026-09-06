/**
 * The ranking engine: signals in, one comparable 0–100 score out.
 *
 * Three ideas do all the work here, and each replaces something the previous
 * scorer got wrong.
 *
 * **1. Weights are resolved per pair, not baked in.**
 * `resolveWeights` starts from the base table, applies the intent profiles
 * (urgency and activity), caps any single signal at `MAX_WEIGHT_SHARE` of the
 * total and renormalises to 100. So what matters depends on what the pair is
 * trying to do, and no parameter can quietly become the whole score — which
 * is what an un-capped multiplier stack does the moment two profiles agree.
 *
 * **2. Missing evidence costs weight, not points.**
 * A signal with nothing to go on returns `null` and is dropped from the
 * weighted mean entirely, instead of contributing a neutral 0.5 at full
 * weight. The old behaviour handed every incomplete profile half of the
 * missing signals' weight for free, so a pair that agreed on two things
 * scored the same as a pair that agreed on six.
 *
 * **3. Thin evidence is shrunk toward the prior.**
 * `coverage` is the share of total weight that had evidence; confidence is
 * `coverage ** SHRINK_EXPONENT`, and the observed mean is pulled that far out
 * from `MATCH_PRIOR`. One matching signal on two otherwise empty profiles can
 * no longer produce a 95 — it produces something just above 50, which is what
 * it actually means. This is what keeps scores comparable across candidates
 * with different amounts of profile filled in, and it is why the threshold
 * ladder means anything.
 */

import {
  ACTIVITY_PROFILES,
  BASE_WEIGHTS,
  MATCH_PRIOR,
  MAX_WEIGHT_SHARE,
  MatchIntent,
  SHRINK_EXPONENT,
  SIGNAL_KEYS,
  SignalKey,
  THRESHOLD,
  URGENCY_PROFILES,
  WeightProfile,
} from './matching.config';
import {
  PairFeedback,
  PairSocial,
  SIGNALS,
  SideContext,
  SignalInput,
  timeRank,
} from './signals';

export interface ScoreOptions {
  feedback?: PairFeedback | null;
  social?: PairSocial | null;
  /** Overridden in tests so a run is reproducible. */
  now?: number;
  /** Forced intent. Normally derived from the pair. */
  intent?: MatchIntent;
}

/** One signal's contribution, kept for explanations and logs. */
export interface SignalOutcome {
  key: SignalKey;
  label: string;
  /** 0..1, or null when the signal had no evidence. */
  value: number | null;
  /** Resolved weight for this pairing, after intent and capping. */
  weight: number;
  /** `value * weight`, or 0 with no evidence. */
  contribution: number;
  note?: string;
}

export interface MatchScore {
  /** 0–100, one decimal place. Comparable across candidates. */
  score: number;
  /** Share of total weight that had evidence behind it. */
  coverage: number;
  /** The weighted mean over evidenced signals only, before shrinkage. */
  observed: number;
  intent: MatchIntent;
  signals: SignalOutcome[];
  /** Legacy view: per-signal 0..1 with no-evidence shown as the neutral
   *  midpoint. Kept because it is what the pairing log has always printed. */
  breakdown: Record<SignalKey, number>;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * What kind of meeting this is, derived from *both* sides.
 *
 * Symmetry is the constraint. Taking the searcher's own intent would make
 * `score(a, b) !== score(b, a)`, so the pair a user is offered would depend
 * on who joined the queue first — and the same pairing would be justified by
 * two different numbers on the two screens. Urgency therefore takes the
 * tighter of the two windows (if either wants to meet now, this is a
 * meet-now problem) and the activity is shared by construction: it is the one
 * hard requirement the candidate query enforces.
 */
export function resolveIntent(a: SideContext, b: SideContext): MatchIntent {
  const ra = timeRank(a.timePreference);
  const rb = timeRank(b.timePreference);
  const ranks = [ra, rb].filter((r): r is 0 | 1 | 2 => r !== null);
  const urgency = ranks.length ? (Math.min(...ranks) as 0 | 1 | 2) : 1;
  const activity =
    (typeof a.activity === 'string' && a.activity) ||
    (typeof b.activity === 'string' && b.activity) ||
    null;
  return { urgency, activity };
}

function multiply(
  weights: Record<SignalKey, number>,
  profile: WeightProfile | undefined,
): void {
  if (!profile) return;
  for (const key of SIGNAL_KEYS) {
    const factor = profile[key];
    if (typeof factor === 'number' && factor > 0) weights[key] *= factor;
  }
}

/**
 * The weight table for one pairing: base × urgency × activity, capped so no
 * signal exceeds its share, then normalised back to a total of 100.
 *
 * The cap runs in a loop because clamping one weight raises every other
 * weight's share of the (now smaller) total, which can push a second one over
 * the line. Two or three passes settle it; the bound is there so a pathological
 * profile cannot spin.
 */
export function resolveWeights(
  intent: MatchIntent,
  overrides?: WeightProfile,
): Record<SignalKey, number> {
  const weights = { ...BASE_WEIGHTS };
  multiply(weights, URGENCY_PROFILES[intent.urgency]);
  if (intent.activity) multiply(weights, ACTIVITY_PROFILES[intent.activity]);
  multiply(weights, overrides);

  const initial = SIGNAL_KEYS.reduce((s, k) => s + weights[k], 0);
  if (!(initial > 0)) return { ...BASE_WEIGHTS };
  for (const key of SIGNAL_KEYS) weights[key] = (weights[key] * 100) / initial;

  // Clamp the excess and hand it to the signals that are still under the
  // ceiling, rather than clamping and renormalising the whole table — that
  // scales the clamped weight straight back over the line it was just pulled
  // under. Redistribution keeps the total at exactly 100 while the cap holds,
  // and a redistribution that lifts someone else over the ceiling is settled
  // by the next pass.
  const ceiling = 100 * MAX_WEIGHT_SHARE;
  const clamped = new Set<SignalKey>();

  for (let pass = 0; pass < 8; pass += 1) {
    const over = SIGNAL_KEYS.filter(
      (k) => !clamped.has(k) && weights[k] > ceiling + 1e-9,
    );
    if (over.length === 0) break;

    let excess = 0;
    for (const key of over) {
      excess += weights[key] - ceiling;
      weights[key] = ceiling;
      clamped.add(key);
    }

    const pool = SIGNAL_KEYS.filter((k) => !clamped.has(k));
    const poolTotal = pool.reduce((s, k) => s + weights[k], 0);
    if (pool.length === 0 || poolTotal <= 0) break;
    for (const key of pool) {
      weights[key] += (excess * weights[key]) / poolTotal;
    }
  }

  return weights;
}

/**
 * Score one pairing.
 *
 * Pure: every input is an argument, including the clock, so the same inputs
 * always produce the same number. All the non-determinism in this feature
 * lives in `selection.ts`, on purpose — a score you cannot reproduce is a
 * score you cannot debug.
 */
export function scorePair(
  a: SideContext,
  b: SideContext,
  options: ScoreOptions = {},
): MatchScore {
  const intent = options.intent ?? resolveIntent(a, b);
  const weights = resolveWeights(intent);
  const input: SignalInput = {
    a,
    b,
    feedback: options.feedback ?? null,
    social: options.social ?? null,
    now: options.now ?? Date.now(),
  };

  const outcomes: SignalOutcome[] = [];
  const breakdown = {} as Record<SignalKey, number>;
  let evidenceWeight = 0;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const signal of SIGNALS) {
    const weight = weights[signal.key] ?? 0;
    totalWeight += weight;

    let value: number | null = null;
    try {
      value = signal.evaluate(input);
    } catch {
      // A signal that throws on malformed data is a missing signal, not a
      // failed match. Conflicting or half-written profiles are ordinary here.
      value = null;
    }
    if (value !== null && !Number.isFinite(value)) value = null;
    if (value !== null) value = clamp01(value);

    if (value !== null) {
      evidenceWeight += weight;
      weightedSum += value * weight;
    }

    breakdown[signal.key] = value ?? MATCH_PRIOR;
    outcomes.push({
      key: signal.key,
      label: signal.label,
      value,
      weight: Math.round(weight * 10) / 10,
      contribution: value === null ? 0 : Math.round(value * weight * 10) / 10,
      note: signal.describe?.(input, value),
    });
  }

  const coverage = totalWeight > 0 ? evidenceWeight / totalWeight : 0;
  const observed =
    evidenceWeight > 0 ? weightedSum / evidenceWeight : MATCH_PRIOR;
  const confidence = coverage <= 0 ? 0 : Math.pow(coverage, SHRINK_EXPONENT);
  const shrunk = MATCH_PRIOR + (observed - MATCH_PRIOR) * confidence;

  return {
    score: Math.round(clamp01(shrunk) * 1000) / 10,
    coverage: Math.round(coverage * 1000) / 1000,
    observed: Math.round(observed * 1000) / 1000,
    intent,
    signals: outcomes,
    breakdown,
  };
}

/**
 * The compatibility floor a pairing must clear, given how long the searcher
 * has already waited.
 *
 * Holds out for a genuinely good partner at first, then progressively accepts
 * a more compromised one rather than leaving someone searching indefinitely.
 * It only ever relaxes *preferences*: the activity is enforced by the query
 * and is never traded away, so the end state is "any same-activity partner
 * beats nobody", which on a quiet campus is the right answer.
 */
export function relaxedThreshold(waitedMs: number): number {
  if (!Number.isFinite(waitedMs) || waitedMs <= 0) return THRESHOLD.start;
  const progress = Math.min(1, waitedMs / THRESHOLD.relaxFullMs);
  const span = THRESHOLD.start - THRESHOLD.floor;
  return THRESHOLD.start - span * progress;
}

/**
 * Why a pair scored what they scored, as one line per signal.
 *
 * This is the answer to "why on earth were those two put together?" — printed
 * on every pairing, and available to a test or a REPL for any hypothetical
 * pair. Ordered by contribution, so the reason is the first line.
 */
export function explainPair(score: MatchScore): string {
  const rows = [...score.signals]
    .sort((x, y) => y.contribution - x.contribution)
    .map((s) => {
      if (s.value === null) return `${s.key}=— (w${s.weight})`;
      const note = s.note ? ` ${s.note}` : '';
      return `${s.key}=${s.value.toFixed(2)}×${s.weight}${note}`;
    });
  return (
    `score=${score.score} observed=${score.observed} ` +
    `coverage=${score.coverage} intent=${score.intent.activity ?? '?'}/u${score.intent.urgency} ` +
    `[${rows.join(' ')}]`
  );
}

/** A compact object for structured logging and debug endpoints. */
export function explainPairJson(score: MatchScore) {
  return {
    score: score.score,
    observed: score.observed,
    coverage: score.coverage,
    intent: score.intent,
    signals: score.signals.map((s) => ({
      key: s.key,
      value: s.value,
      weight: s.weight,
      contribution: s.contribution,
      ...(s.note ? { note: s.note } : {}),
    })),
  };
}
