import { randomInt } from 'crypto';

/** A uniform float in [0, 1) from the CSPRNG — see sample-random.util for why. */
function cryptoRandom(): number {
  return randomInt(2 ** 47) / 2 ** 47;
}

/**
 * Draws `count` rows without replacement, each with probability proportional
 * to its score (Efraimidis–Spirakis: key = u^(1/w), keep the largest keys).
 *
 * A uniform draw (`sampleRandom`) makes the 60th-best candidate exactly as
 * likely to appear as the best one: ranking decides only who enters the pool. Weighting keeps the variety
 * between reloads (anyone in the pool can still appear) while strong matches
 * appear most of the time.
 *
 * Every weight is floored at a small positive value, so a zero-score
 * candidate is unlikely rather than impossible, and a pool of all zeros
 * degrades to a uniform draw instead of an empty one.
 */
export function weightedSample<T extends { score: number }>(
  rows: readonly T[],
  count: number,
  random: () => number = cryptoRandom,
): T[] {
  if (rows.length <= count) return [...rows];
  const MIN_WEIGHT = 0.05;
  return rows
    .map((row) => {
      const weight = Math.max(row.score, MIN_WEIGHT);
      // `1 - random()` keeps the base in (0, 1], so log(0) is impossible.
      return { row, key: Math.log(1 - random()) / weight };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((entry) => entry.row);
}
