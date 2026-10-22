import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A response that lands after sign-out must not reach the next account.
 *
 * The queryFns that mirror data into IndexedDB write after their network
 * await, and `queryClient.clear()` does not abort a fetch already in flight.
 * So account A's profile (with A's `isFollowing`) or community list (with A's
 * `isJoined`) used to be written back into the store a moment after A's logout
 * emptied it, and account B's next mount seeded from it.
 *
 * The fake below is the smallest IndexedDB that behaves like the real one where
 * it matters here: requests and transactions complete asynchronously, so a
 * clear can land between a caller's await and its write.
 */

function installFakeIndexedDB() {
  const stores = new Map();
  const later = (fn) => setTimeout(fn, 0);

  const objectStore = (name, tx) => {
    const data = stores.get(name);
    const request = (run) => {
      const req = {};
      tx.pending += 1;
      later(() => {
        req.result = run();
        req.onsuccess?.();
        tx.pending -= 1;
        if (tx.pending === 0) later(() => tx.oncomplete?.());
      });
      return req;
    };
    return {
      put: (value) => request(() => { data.set(value.key, value); }),
      get: (key) => request(() => data.get(key)),
      delete: (key) => request(() => { data.delete(key); }),
      clear: () => request(() => { data.clear(); }),
    };
  };

  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n) => { stores.set(n, new Map()); },
    transaction: (name) => {
      const tx = { pending: 0 };
      tx.objectStore = (n) => objectStore(n ?? name, tx);
      return tx;
    },
  };

  globalThis.indexedDB = {
    open: () => {
      const req = {};
      later(() => {
        req.onupgradeneeded?.({ target: { result: db } });
        req.onsuccess?.({ target: { result: db } });
      });
      return req;
    },
  };
  return stores;
}

let idb;
beforeEach(async () => {
  installFakeIndexedDB();
  vi.resetModules();
  idb = await import('../idb');
});

describe('IndexedDB cache epoch', () => {
  it('stores a write whose epoch is still current', async () => {
    const epoch = idb.idbEpoch();
    await idb.idbSet('profiles', 'alice', { isFollowing: true }, epoch);
    expect((await idb.idbGet('profiles', 'alice'))?.value).toEqual({ isFollowing: true });
  });

  it('drops a write captured before a sign-out cleared the cache', async () => {
    const epoch = idb.idbEpoch(); // queryFn starts its request as account A
    await idb.idbClearAll(); // A signs out while it is in flight
    await idb.idbSet('profiles', 'alice', { isFollowing: true }, epoch); // A's response lands
    expect(await idb.idbGet('profiles', 'alice')).toBeNull();
  });

  it('drops a write when the clear lands while the write is opening the database', async () => {
    const write = idb.idbSet('communities', 'all', [{ isJoined: true }], idb.idbEpoch());
    const clear = idb.idbClearAll();
    await Promise.all([write, clear]);
    expect(await idb.idbGet('communities', 'all')).toBeNull();
  });

  it('returns nothing from a read that was in flight when the cache was cleared', async () => {
    await idb.idbSet('profiles', 'alice', { isFollowing: true });
    const read = idb.idbGet('profiles', 'alice'); // a hydration for A, still pending
    const clear = idb.idbClearAll();
    expect(await read).toBeNull();
    await clear;
  });

  it('has committed the clear by the time idbClearAll resolves', async () => {
    await idb.idbSet('feed', 'home', [1, 2, 3]);
    await idb.idbClearAll();
    expect(await idb.idbGet('feed', 'home')).toBeNull();
  });

  it('keeps writes without an epoch working, for callers that are not racing a fetch', async () => {
    await idb.idbClearAll();
    await idb.idbSet('config', 'k', 1);
    expect((await idb.idbGet('config', 'k'))?.value).toBe(1);
  });
});
