import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeIndexedDB } from './helpers/fakeIndexedDB';

/**
 * The on-device cache is bounded: entries older than three TTLs are deleted, and
 * each store is held to its cap, least recently written first. Nothing but a
 * read of an entry ever removed one before, so entries nobody asked for again
 * stayed on the device forever.
 */

const MIN = 60 * 1000;
const T0 = 1_800_000_000_000;

let idb;
let fake;
let clock;
beforeEach(async () => {
  fake = installFakeIndexedDB();
  clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.resetModules();
  idb = await import('../idb');
});
afterEach(() => {
  vi.restoreAllMocks();
});

const keysIn = (store) => [...fake.db('meetifyy_cache').stores.get(store).data.keys()];
const writeAt = async (store, key, at) => {
  clock = at;
  await idb.idbSet(store, key, { key });
};

describe('idbMaintainCache', () => {
  it('trims a store to its cap, dropping the least recently written first', async () => {
    for (let i = 0; i < 60; i += 1) await writeAt('profiles', `u${i}`, T0 + i * 1000);
    clock = T0 + 61 * 1000;

    const removed = await idb.idbMaintainCache(clock);

    const left = keysIn('profiles');
    expect(removed).toBe(10);
    expect(left).toHaveLength(50);
    expect(left).not.toContain('u0');
    expect(left).not.toContain('u9');
    expect(left).toContain('u10');
    expect(left).toContain('u59');
  });

  it('applies a different cap to each store', async () => {
    for (let i = 0; i < 25; i += 1) await writeAt('communities', `c${i}`, T0 + i);
    for (let i = 0; i < 25; i += 1) await writeAt('config', `k${i}`, T0 + i);
    clock = T0 + 100;

    await idb.idbMaintainCache(clock);

    expect(keysIn('communities')).toHaveLength(20); // cap 20
    expect(keysIn('config')).toHaveLength(25); // under its cap of 50
  });

  it('deletes entries more than three TTLs old, and keeps merely stale ones', async () => {
    // search has a 2 minute TTL: ancient at 7 min, stale but kept at 5 min.
    await writeAt('search', 'ancient', T0 - 7 * MIN);
    await writeAt('search', 'stale', T0 - 5 * MIN);
    await writeAt('search', 'fresh', T0 - 10 * 1000);
    clock = T0;

    await idb.idbMaintainCache(clock);

    expect(keysIn('search').sort()).toEqual(['fresh', 'stale']);
    // A stale entry is still served, flagged for revalidation.
    expect((await idb.idbGet('search', 'stale'))?.isStale).toBe(true);
  });

  it('uses the longer TTL of the app query snapshots', async () => {
    const DAY = 24 * 60 * MIN;
    await writeAt('queries', 'old', T0 - 10 * DAY); // > 3 x 3 days
    await writeAt('queries', 'recent', T0 - 8 * DAY); // stale, inside 9 days
    clock = T0;

    await idb.idbMaintainCache(clock);

    expect(keysIn('queries')).toEqual(['recent']);
  });

  it('leaves an under-cap, unexpired cache untouched', async () => {
    await writeAt('feed', 'home', T0);
    await writeAt('profiles', 'alice', T0);

    expect(await idb.idbMaintainCache(T0 + 1000)).toBe(0);
    expect(keysIn('feed')).toEqual(['home']);
    expect(keysIn('profiles')).toEqual(['alice']);
  });

  it('stands down when a sign-out starts the next generation while it runs', async () => {
    for (let i = 0; i < 60; i += 1) await writeAt('profiles', `u${i}`, T0 + i);
    clock = T0 + 100;

    const pass = idb.idbMaintainCache(clock);
    idb.bumpIdbEpoch(); // sign-out begins before the pass has read anything
    expect(await pass).toBe(0);
    expect(keysIn('profiles')).toHaveLength(60);
  });

  it('never throws when storage is unavailable', async () => {
    globalThis.indexedDB = { open: () => { throw new Error('denied'); } };
    vi.resetModules();
    const fresh = await import('../idb');
    await expect(fresh.idbMaintainCache()).resolves.toBe(0);
  });
});

describe('idbClearCache', () => {
  it('empties every store, reports success, and keeps the clear generation', async () => {
    await idb.idbSet('feed', 'home', 1);
    await idb.idbSet('queries', 'q', 2);
    const epoch = idb.idbEpoch();

    expect(await idb.idbClearCache()).toBe(true);

    expect(await idb.idbGet('feed', 'home')).toBeNull();
    expect(await idb.idbGet('queries', 'q')).toBeNull();
    expect(idb.idbEpoch()).toBe(epoch);
  });
});
