import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A chat response that lands after sign-out must not reach the next account.
 *
 * useChatManager mirrors messages to disk after a network await (a history
 * page, an upload, a send ACK), and signing out does not abort a request
 * already in flight. Account A's DMs used to be written back into
 * `meetifyy_messages` a moment after A's logout emptied it.
 *
 * The fake is the smallest IndexedDB that behaves like the real one where it
 * matters: requests and transactions complete asynchronously, a transaction
 * spans several stores, and an index can be read by key.
 */

function installFakeIndexedDB() {
  const stores = new Map(); // name -> { keyPath, data: Map, indexes: Map<name, keyPath> }
  const later = (fn) => setTimeout(fn, 0);

  const objectStore = (name, tx) => {
    const s = stores.get(name);
    const request = (run) => {
      const req = {};
      tx.pending += 1;
      later(() => {
        req.result = run();
        req.onsuccess?.({ target: req });
        tx.pending -= 1;
        if (tx.pending === 0) later(() => tx.oncomplete?.());
      });
      return req;
    };
    const keyOf = (v) => v[s.keyPath];
    return {
      put: (value) => request(() => { s.data.set(keyOf(value), value); }),
      get: (key) => request(() => s.data.get(key)),
      delete: (key) => request(() => { s.data.delete(key); }),
      clear: () => request(() => { s.data.clear(); }),
      createIndex: (iname, keyPath) => { s.indexes.set(iname, keyPath); },
      index: (iname) => {
        const keyPath = s.indexes.get(iname);
        return {
          getAll: (range) => request(() => [...s.data.values()].filter((v) => v[keyPath] === range.value)),
        };
      },
    };
  };

  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n, opts) => {
      stores.set(n, { keyPath: opts.keyPath, data: new Map(), indexes: new Map() });
      return objectStore(n, { pending: 0 });
    },
    transaction: (names) => {
      const tx = { pending: 0 };
      const first = Array.isArray(names) ? names[0] : names;
      tx.objectStore = (n) => objectStore(n ?? first, tx);
      return tx;
    },
  };

  globalThis.IDBKeyRange = { only: (value) => ({ value }) };
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

const msg = (id, text = 'hi') => ({ id, text, createdAt: '2026-10-01T00:00:00Z', status: 'sent' });

let m;
beforeEach(async () => {
  installFakeIndexedDB();
  vi.resetModules();
  m = await import('../idbMessages');
});

describe('message cache epoch', () => {
  it('stores a page whose epoch is still current', async () => {
    await m.idbSaveMessages('c1', [msg('m1')], m.idbMessagesEpoch());
    expect((await m.idbGetMessages('c1')).map((x) => x.id)).toEqual(['m1']);
  });

  it('drops a page fetched before a sign-out cleared the cache', async () => {
    const epoch = m.idbMessagesEpoch(); // page request starts as account A
    await m.idbClearMessages(); // A signs out while it is in flight
    await m.idbSaveMessages('c1', [msg('m1', 'secret')], epoch); // A's page lands
    expect(await m.idbGetMessages('c1')).toEqual([]);
  });

  it('drops a write when the clear lands while the write is opening the database', async () => {
    const write = m.idbSaveMessages('c1', [msg('m1')], m.idbMessagesEpoch());
    const clear = m.idbClearMessages();
    await Promise.all([write, clear]);
    expect(await m.idbGetMessages('c1')).toEqual([]);
  });

  it('drops a stale patch (a send ACK that resolved after sign-out)', async () => {
    const epoch = m.idbMessagesEpoch();
    await m.idbClearMessages();
    await m.idbPatchMessage('c1', 'm1', { id: 'm1', conversationId: 'c1', text: 'secret', status: 'sent' }, epoch);
    expect(await m.idbGetMessages('c1')).toEqual([]);
  });

  it('drops stale sync metadata', async () => {
    const epoch = m.idbMessagesEpoch();
    await m.idbClearMessages();
    await m.idbSaveSyncMeta('c1', { nextCursor: 'x' }, epoch);
    expect(await m.idbGetSyncMeta('c1')).toBeUndefined();
  });

  it('returns nothing from a read that was in flight when the cache was cleared', async () => {
    await m.idbSaveMessages('c1', [msg('m1')]);
    await m.idbSaveSyncMeta('c1', { nextCursor: 'x' });
    const read = m.idbGetMessages('c1');
    const metaRead = m.idbGetSyncMeta('c1');
    const clear = m.idbClearMessages();
    expect(await read).toEqual([]);
    expect(await metaRead).toBeNull();
    await clear;
  });

  it('has committed the clear by the time idbClearMessages resolves', async () => {
    await m.idbSaveMessages('c1', [msg('m1')]);
    await m.idbClearMessages();
    expect(await m.idbGetMessages('c1')).toEqual([]);
  });

  it('keeps writes without an epoch working', async () => {
    await m.idbClearMessages();
    await m.idbSaveMessages('c1', [msg('m1')]);
    await m.idbPatchMessage('c1', 'm1', { id: 'm1', conversationId: 'c1', text: 'edited' });
    await m.idbSaveSyncMeta('c1', { nextCursor: 'y' });
    const [stored] = await m.idbGetMessages('c1');
    expect(stored.text).toBe('edited');
    expect((await m.idbGetSyncMeta('c1'))?.nextCursor).toBe('y');
  });
});
