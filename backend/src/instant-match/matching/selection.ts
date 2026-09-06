/**
 * Turning scores into an order to try.
 *
 * Sorting by score alone is repeatable in the bad sense. The same searcher is
 * offered the same partner on every sweep; two candidates a tenth of a point
 * apart are treated as if that difference were real (it is not — the score is
 * an estimate with a shrinkage term in it); and whoever Postgres happened to
 * return first wins every tie forever. On a campus-sized queue that is how a
 * user ends up seeing the same four people all week.
 *
 * So the order is built in bands:
 *
 *  - Everything below the searcher's relaxed threshold is dropped.
 *  - Candidates within `tieBandPoints` of the leader are treated as tied and
 *    drawn between, weighted by how long each has been waiting — fairness
 *    where the score has nothing left to say.
 *  - `exploreRate` of the time the draw comes from *below* that band instead
 *    (but no further down than `exploreBandPoints`): the promising
 *    less-obvious candidate. This is the only thing that stops the ranker
 *    from spending forever confirming what it already believes.
 *
 * All randomness comes from an injected `rng`, so a test — or a production
 * incident — can replay an ordering exactly. `Math.random` is the default and
 * is the right tool here: this is presentation jitter, not a token, an id, a
 * secret or a lock value, and nothing downstream is protected by it being
 * unpredictable.
 */

import { SELECTION } from './matching.config';
import { relaxedThreshold } from './engine';

export interface Rankable {
  /** 0–100 compatibility. */
  score: number;
  /** ms epoch — when this candidate joined the queue. */
  joinedAt: number;
}

export interface OrderOptions {
  /** ms epoch of the searcher's own join, for the threshold ladder. */
  searcherJoinedAt: number;
  now?: number;
  /** Defaults to `Math.random`. Inject for reproducible ordering. */
  rng?: () => number;
  /** Skip the draws entirely: pure score order, longest wait breaking ties.
   *  Used by tests and by anything that has to explain an ordering exactly. */
  deterministic?: boolean;
}

export interface OrderedCandidate<T extends Rankable> {
  item: T;
  /** The floor this candidate had to clear. */
  threshold: number;
  /** How it was chosen: the leading band, or an exploration draw. */
  picked: 'lead' | 'explore';
}

/**
 * The bar this pairing has to clear.
 *
 * Whoever has waited longer sets it: a five-minute waiter should not be held
 * back because their best partner joined ten seconds ago, and the person who
 * just arrived is not harmed by being matched sooner than they expected.
 */
export function thresholdFor(
  searcherJoinedAt: number,
  candidateJoinedAt: number,
  now: number,
): number {
  const waited = Math.max(now - searcherJoinedAt, now - candidateJoinedAt);
  return relaxedThreshold(waited);
}

/** Longer waits are drawn more often, but never exclusively — see
 *  `SELECTION.waitWeightCap` for why the advantage is bounded. */
function waitWeight(item: Rankable, now: number): number {
  const waited = Math.max(0, now - item.joinedAt);
  return 1 + Math.min(waited / SELECTION.waitWeightMs, SELECTION.waitWeightCap);
}

function drawIndex<T extends Rankable>(
  pool: T[],
  now: number,
  rng: () => number,
): number {
  if (pool.length === 1) return 0;
  const weights = pool.map((item) => waitWeight(item, now));
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return 0;

  // `rng() * total` with a running sum: an rng that returns 0 always picks
  // index 0, which is what makes `deterministic` and a stubbed rng agree with
  // plain score order.
  let ticket = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    ticket -= weights[i];
    if (ticket <= 0) return i;
  }
  return pool.length - 1;
}

/**
 * Filter to what is actually matchable, then order it.
 *
 * Returns every eligible candidate rather than just a winner, because the
 * caller races for each pairing in turn: claiming one can lose to a concurrent
 * match, and it must be able to fall through to the next without re-running
 * the whole ranking.
 */
export function orderCandidates<T extends Rankable>(
  candidates: readonly T[],
  options: OrderOptions,
): OrderedCandidate<T>[] {
  const now = options.now ?? Date.now();
  const rng = options.rng ?? Math.random;

  const eligible = candidates
    .map((item) => ({
      item,
      threshold: thresholdFor(options.searcherJoinedAt, item.joinedAt, now),
    }))
    .filter((entry) => entry.item.score >= entry.threshold)
    // Best first; ties toward whoever has been waiting longest, so the pool a
    // draw sees is itself in a fair order.
    .sort(
      (x, y) =>
        y.item.score - x.item.score || x.item.joinedAt - y.item.joinedAt,
    );

  if (options.deterministic) {
    return eligible.map((entry) => ({ ...entry, picked: 'lead' as const }));
  }

  const remaining = [...eligible];
  const out: OrderedCandidate<T>[] = [];

  while (remaining.length > 0) {
    const leader = remaining[0].item.score;
    const leadEnd = remaining.findIndex(
      (e) => e.item.score < leader - SELECTION.tieBandPoints,
    );
    const lead = leadEnd === -1 ? remaining : remaining.slice(0, leadEnd);

    const explore =
      leadEnd === -1
        ? []
        : remaining
            .slice(leadEnd)
            .filter(
              (e) => e.item.score >= leader - SELECTION.exploreBandPoints,
            );

    const exploring = explore.length > 0 && rng() < SELECTION.exploreRate;
    const pool = exploring ? explore : lead;

    const index = drawIndex(
      pool.map((e) => e.item),
      now,
      rng,
    );
    const chosen = pool[index];

    out.push({
      item: chosen.item,
      threshold: chosen.threshold,
      picked: exploring ? 'explore' : 'lead',
    });
    remaining.splice(remaining.indexOf(chosen), 1);
  }

  return out;
}
