/**
 * The smallest IndexedDB that behaves like the real one where the cache tests
 * need it: several databases, each with several stores; requests and
 * transactions complete asynchronously (so a clear can land between an await
 * and a write); a transaction can span stores; cursors, `getAll` and an index
 * read by key work.
 *
 * It grew out of the fakes in idbEpoch.test.js and idbMessagesEpoch.test.js,
 * which this supersedes for tests that touch more than one database.
 *
 * `install()` returns `{ db(name) }`, whose `.stores.get(storeName).data` is
 * the Map of records, for seeding and inspecting without going through the
 * code under test.
 */
export function installFakeIndexedDB() {
  const databases = new Map(); // name -> { stores: Map<name, { keyPath, data, indexes }> }
  const later = (fn) => setTimeout(fn, 0);

  const objectStore = (db, name, tx) => {
    const s = db.stores.get(name);
    const settle = () => {
      tx.pending -= 1;
      if (tx.pending === 0) later(() => { if (tx.pending === 0) tx.oncomplete?.(); });
    };
    const request = (run) => {
      const req = {};
      tx.pending += 1;
      later(() => {
        req.result = run();
        req.onsuccess?.({ target: req });
        settle();
      });
      return req;
    };
    const keyOf = (v) => v[s.keyPath];
    return {
      put: (value) => request(() => { s.data.set(keyOf(value), value); }),
      get: (key) => request(() => s.data.get(key)),
      getAll: () => request(() => [...s.data.values()]),
      count: () => request(() => s.data.size),
      delete: (key) => request(() => { s.data.delete(key); }),
      clear: () => request(() => { s.data.clear(); }),
      openCursor: () => {
        const req = {};
        const entries = [...s.data.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        let i = 0;
        tx.pending += 1;
        const step = () => later(() => {
          if (i < entries.length) {
            const [key, value] = entries[i];
            i += 1;
            req.result = {
              key,
              primaryKey: key,
              value,
              continue: step,
              delete: () => request(() => { s.data.delete(key); }),
            };
            req.onsuccess?.({ target: req });
          } else {
            req.result = null;
            req.onsuccess?.({ target: req });
            settle();
          }
        });
        step();
        return req;
      },
      createIndex: (iname, keyPath) => { s.indexes.set(iname, keyPath); },
      index: (iname) => {
        const keyPath = s.indexes.get(iname);
        return {
          getAll: (range) => request(() => [...s.data.values()].filter((v) => v[keyPath] === range.value)),
        };
      },
    };
  };

  const makeDb = (record) => ({
    objectStoreNames: { contains: (n) => record.stores.has(n) },
    createObjectStore: (n, opts) => {
      record.stores.set(n, { keyPath: opts.keyPath, data: new Map(), indexes: new Map() });
      return objectStore(record, n, { pending: 0 });
    },
    close: () => {},
    transaction: (names) => {
      const tx = { pending: 0 };
      const first = Array.isArray(names) ? names[0] : names;
      tx.objectStore = (n) => objectStore(record, n ?? first, tx);
      return tx;
    },
  });

  globalThis.IDBKeyRange = { only: (value) => ({ value }) };
  globalThis.indexedDB = {
    open: (name) => {
      const req = {};
      later(() => {
        let record = databases.get(name);
        const fresh = !record;
        if (fresh) {
          record = { stores: new Map() };
          record.db = makeDb(record);
          databases.set(name, record);
        }
        if (fresh) req.onupgradeneeded?.({ target: { result: record.db } });
        req.result = record.db;
        req.onsuccess?.({ target: { result: record.db } });
      });
      return req;
    },
  };

  return { db: (name) => databases.get(name) };
}
