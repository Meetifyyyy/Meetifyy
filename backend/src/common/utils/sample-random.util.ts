import { randomInt } from 'crypto';

/**
 * `count` items drawn at random from `items`, without replacement.
 *
 * A partial Fisher–Yates: only the first `count` positions are settled, so
 * drawing 3 from a pool of 60 costs three swaps rather than a full shuffle.
 * The input array is not modified.
 *
 * Returns everything (in random order) when the pool is smaller than `count`,
 * which is the graceful case for a recommendation panel on a small or
 * nearly-exhausted dataset — a short list beats an empty one.
 *
 * `randomInt` rather than `Math.random`: this is not a token, an id or a lock
 * value, so the project's rule about `Math.random` does not strictly bite, but
 * the CSPRNG costs nothing at these sizes and leaves no judgement call for the
 * next reader to re-litigate.
 */
export function sampleRandom<T>(items: T[], count: number): T[] {
  if (!Array.isArray(items) || items.length === 0 || count <= 0) return [];
  if (items.length <= count) {
    // Still shuffled: an exhausted pool should not freeze into one fixed order.
    count = items.length;
  }

  const pool = [...items];
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
