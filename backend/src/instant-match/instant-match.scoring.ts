/**
 * Instant Match compatibility scoring — the stable entry point.
 *
 * The implementation moved to `matching/`, which is where the interesting
 * decisions now live:
 *
 *   matching.config.ts  every tunable number — weights, intent profiles,
 *                       feedback ladders, selection and threshold constants
 *   signals.ts          the signal registry; adding a signal happens here
 *   engine.ts           weight resolution, normalisation, shrinkage, explain
 *   selection.ts        thresholds, tie bands and exploration
 *
 * This file stays because the shape it exports is used across the service and
 * its tests, and because the two rules it was written to enforce are still the
 * rules:
 *
 *  1. **The activity is the only hard requirement.** It is enforced by the
 *     candidate query, never here. Everything else is a preference that moves
 *     the ranking and can never disqualify a pairing on its own.
 *  2. **Unknown is not bad.** A signal with nothing to go on is dropped from
 *     the weighted mean rather than counted as disagreement — and, since the
 *     rewrite, dropped from the *confidence* too, so a sparse profile scores
 *     near the prior instead of being handed half of every missing signal's
 *     weight for free.
 */

import {
  MatchScore,
  ScoreOptions,
  explainPair,
  explainPairJson,
  relaxedThreshold,
  resolveIntent,
  resolveWeights,
  scorePair,
} from './matching/engine';
import { BASE_WEIGHTS, SignalKey, THRESHOLD } from './matching/matching.config';
import { PairFeedback, PairSocial, SideContext } from './matching/signals';

export type QueueEntryContext = SideContext & {
  /** Legacy field: prior conversations between the pair. Superseded by
   *  `PairFeedback.accepted`, and mapped onto it when only this is given. */
  priorConversations?: number | null;
};

export type MatchFactor = SignalKey;
export type ScoreBreakdown = Record<MatchFactor, number>;
export type { MatchScore, PairFeedback, PairSocial, SideContext };

/** The base weight table. Per-pairing weights come from `resolveWeights`,
 *  which applies the intent profiles and the per-signal cap on top. */
export const MATCH_WEIGHTS = BASE_WEIGHTS;

export const MATCH_THRESHOLD_START = THRESHOLD.start;
export const MATCH_THRESHOLD_FLOOR = THRESHOLD.floor;
export const MATCH_RELAX_FULL_MS = THRESHOLD.relaxFullMs;

export {
  relaxedThreshold,
  resolveIntent,
  resolveWeights,
  explainPair,
  explainPairJson,
};

/** Full weighted compatibility with a per-signal breakdown. Symmetric: the
 *  pair scores the same regardless of who joined the queue first. */
export function computeCompatibility(
  a: QueueEntryContext,
  b: QueueEntryContext,
  options: ScoreOptions = {},
): MatchScore {
  return scorePair(a, b, {
    ...options,
    feedback: options.feedback ?? legacyFeedback(a, b),
  });
}

/** Convenience wrapper for callers that only need the number. */
export function computeMatchScore(
  a: QueueEntryContext,
  b: QueueEntryContext,
  options: ScoreOptions = {},
): number {
  return computeCompatibility(a, b, options).score;
}

/**
 * Bridges the old single `priorConversations` field onto the feedback shape.
 *
 * Callers that pass real feedback never reach this; it exists so an older
 * call site (or a test) that only knows "they have matched before" still
 * feeds the familiarity signal instead of silently losing it.
 */
function legacyFeedback(
  a: QueueEntryContext,
  b: QueueEntryContext,
): PairFeedback | null {
  const prior = a.priorConversations ?? b.priorConversations ?? null;
  if (prior == null || prior <= 0) return null;
  return {
    accepted: prior,
    declinedByMe: 0,
    declinedByThem: 0,
    expired: 0,
    lastPairedAt: null,
  };
}
