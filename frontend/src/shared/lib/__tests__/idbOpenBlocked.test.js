import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A database upgrade must not hang behind a tab still holding the old version.
 *
 * The cache and messages databases were bumped. A web tab running the previous
 * bundle keeps the old version open, so the new tab's open fired `blocked` and
 * then nothing, and every IndexedDB call (the sign-out clear included) waited
 * forever. Now a blocked open gives up after a few seconds (callers see a cache
 * miss), the next call tries again, and an open connection steps aside when a
 * newer tab asks for an upgrade.
 */

/** An indexedDB whose opens stay pending until the test settles them. */
function installControllableIndexedDB() {
  const requests = [];
  const makeDb = () => {
    const db = {
      closed: false,
      close: vi.fn(() => { db.closed = true; }),
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx = {
          objectStore: () => ({
            get: () => {
              const req = {};
              setTimeout(() => { req.result = undefined; req.onsuccess?.(); }, 0);
              return req;
            },
          }),
        };
        return tx;
      },
    };
    return db;
  };
  globalThis.indexedDB = {
    open: vi.fn(() => {
      const req = {};
      requests.push(req);
      return req;
    }),
  };
  return {
    requests,
    block: (req) => req.onblocked?.(),
    succeed: (req) => {
      const db = makeDb();
      req.result = db;
      req.onsuccess?.({ target: req });
      return db;
    },
  };
}

let idb;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  idb = installControllableIndexedDB();
});
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.indexedDB;
});

describe.each([
  ['cache (idb.js)', async () => {
    const m = await import('../idb');
    return (key) => m.idbGet('queries', key);
  }],
  ['messages (idbMessages.js)', async () => {
    const m = await import('../../../features/messages/shared/utils/idbMessages');
    return (key) => m.idbGetSyncMeta(key);
  }],
])('%s open', (_name, load) => {
  it('gives up on a blocked upgrade instead of hanging, and retries later', async () => {
    const read = await load();
    const first = read('k');
    await vi.advanceTimersByTimeAsync(0);
    expect(idb.requests).toHaveLength(1);
    idb.block(idb.requests[0]);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(first).resolves.toBeNull();

    // The next call opens again rather than reusing the failed attempt.
    const second = read('k');
    await vi.advanceTimersByTimeAsync(0);
    expect(idb.requests).toHaveLength(2);
    idb.succeed(idb.requests[1]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(second).resolves.toBeFalsy();
  });

  it('closes and forgets its connection when another tab upgrades', async () => {
    const read = await load();
    const first = read('k');
    await vi.advanceTimersByTimeAsync(0);
    const db = idb.succeed(idb.requests[0]);
    await vi.advanceTimersByTimeAsync(10);
    await first;

    db.onversionchange();
    expect(db.close).toHaveBeenCalled();
    const second = read('k');
    await vi.advanceTimersByTimeAsync(0);
    expect(idb.requests).toHaveLength(2);
    idb.succeed(idb.requests[1]);
    await vi.advanceTimersByTimeAsync(10);
    await second;
  });
});
