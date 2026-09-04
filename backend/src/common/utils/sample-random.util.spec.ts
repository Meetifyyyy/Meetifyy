import { sampleRandom } from './sample-random.util';

/**
 * The draw behind both recommendation panels.
 *
 * The properties that matter are the boring ones — no duplicates, nothing
 * invented, the caller's array left alone — because a bug in any of them shows
 * up as a duplicated or phantom card rather than as an exception.
 */
describe('sampleRandom', () => {
  const pool = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}` }));

  it('returns exactly the requested count', () => {
    expect(sampleRandom(pool, 3)).toHaveLength(3);
    expect(sampleRandom(pool, 1)).toHaveLength(1);
  });

  it('never repeats an item', () => {
    for (let run = 0; run < 50; run++) {
      const picked = sampleRandom(pool, 5);
      expect(new Set(picked.map((p) => p.id)).size).toBe(5);
    }
  });

  it('only ever returns items from the pool', () => {
    const ids = new Set(pool.map((p) => p.id));
    for (const item of sampleRandom(pool, 10)) {
      expect(ids.has(item.id)).toBe(true);
    }
  });

  it('does not modify the caller’s array', () => {
    const original = [...pool];
    sampleRandom(pool, 10);
    expect(pool).toEqual(original);
  });

  it('returns everything when the pool is smaller than the count', () => {
    // The graceful case: a new account, or one that has already followed most
    // of its campus, gets a short panel rather than an empty one.
    const small = [{ id: 'a' }, { id: 'b' }];
    const picked = sampleRandom(small, 5);
    expect(picked).toHaveLength(2);
    expect(picked.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('handles the empty and zero cases without throwing', () => {
    expect(sampleRandom([], 3)).toEqual([]);
    expect(sampleRandom(pool, 0)).toEqual([]);
    expect(sampleRandom(undefined as any, 3)).toEqual([]);
  });

  it('actually varies between calls', () => {
    // The whole point: a fixed top-N is what made the panels look broken.
    const seen = new Set<string>();
    for (let run = 0; run < 40; run++) {
      seen.add(
        sampleRandom(pool, 3)
          .map((p) => p.id)
          .join(','),
      );
    }
    // 40 draws of 3 from 40 colliding into a single result would be a
    // ~1-in-10^60 accident; anything less than a handful means it is not
    // sampling.
    expect(seen.size).toBeGreaterThan(5);
  });

  it('shuffles even an exhausted pool, so the order is not frozen', () => {
    const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const orders = new Set<string>();
    for (let run = 0; run < 40; run++) {
      orders.add(
        sampleRandom(three, 3)
          .map((p) => p.id)
          .join(','),
      );
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
