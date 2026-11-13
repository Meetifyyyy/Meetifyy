/**
 * What is recorded about each proposed match (phase 1 of the learning plan,
 * `docs/private/backend-optimization/E7_MATCHING_ALGORITHM_REVIEW.md`).
 *
 * The per-signal values and weights the pairing was judged on, its intent,
 * and how it was chosen. With the outcome the session already records
 * (accepted, declined and by whom, timed out) and the message counts written
 * when its chat ends, this is the training row a learned ranker is fitted on.
 *
 * Only numbers between 0 and 1 and the weights: never the raw inputs. No
 * coordinates, no campus, no text — a signal's value says how close two
 * people were, not where either of them was.
 */
import type { MutualScore } from './engine';

/** Bumped whenever the shape or the meaning of a field changes. */
export const FEATURE_VERSION = 1;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function proposalFeatures(input: {
  source: 'ranker' | 'request';
  mutual: MutualScore;
  /** The bar it had to clear; null for a direct request (no bar). */
  threshold: number | null;
  /** How the ranker chose it; null for a direct request. */
  picked: 'lead' | 'explore' | null;
  /** The longer of the two waits, ms. */
  waitedMs: number;
  /** How many could have been matched in that attempt. */
  poolSize: number;
}): { [key: string]: Json } {
  const { detail } = input.mutual;
  const signals: { [key: string]: Json } = {};
  for (const s of detail.signals) {
    signals[s.key] = { value: s.value, weight: s.weight };
  }
  return {
    v: FEATURE_VERSION,
    source: input.source,
    score: detail.score,
    ab: input.mutual.ab,
    ba: input.mutual.ba,
    observed: detail.observed,
    coverage: detail.coverage,
    intent: {
      urgency: detail.intent.urgency,
      activity: detail.intent.activity,
    },
    signals,
    threshold:
      input.threshold === null ? null : Math.round(input.threshold * 10) / 10,
    picked: input.picked,
    waitedMs: Math.max(0, Math.round(input.waitedMs)),
    poolSize: input.poolSize,
  };
}
