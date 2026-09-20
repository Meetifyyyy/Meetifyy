import { describe, it, expect, beforeEach } from 'vitest';
import { createEtagCache, ETAG_PREFIX } from '../etagCache';

/** A SyncKeyValueStore backed by a Map, which is what a native client uses. */
function memoryStore() {
  const m = new Map();
  return {
    m,
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    remove: (k) => m.delete(k),
    clearPrefixed: (p) => {
      for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k);
    },
  };
}

describe('createEtagCache', () => {
  let store, cache;
  beforeEach(() => {
    store = memoryStore();
    cache = createEtagCache({ store });
  });

  it('round-trips a validator', () => {
    cache.set('/api/posts/feed', 'W/"abc"');
    expect(cache.get('/api/posts/feed')).toBe('W/"abc"');
  });

  it('returns empty string, not null, for an unknown URL', () => {
    // Callers put this straight into an If-None-Match header, so the empty
    // string is the usable absence and null is not.
    expect(cache.get('/api/nope')).toBe('');
  });

  it('ignores a falsy validator rather than storing one', () => {
    // A response without an ETag means "no validator". Storing '' would make
    // the next request send `If-None-Match: `, which is a different claim.
    cache.set('/api/x', '');
    cache.set('/api/x', null);
    cache.set('/api/x', undefined);
    expect(store.m.size).toBe(0);
    expect(cache.get('/api/x')).toBe('');
  });

  it('drops a single validator', () => {
    cache.set('/a', '1');
    cache.set('/b', '2');
    cache.drop('/a');
    expect(cache.get('/a')).toBe('');
    expect(cache.get('/b')).toBe('2');
  });

  it('namespaces its keys so clear() takes only its own', () => {
    store.set('loggedIn', 'true');
    cache.set('/a', '1');
    cache.set('/b', '2');
    expect([...store.m.keys()].filter((k) => k.startsWith(ETAG_PREFIX))).toHaveLength(2);

    cache.clear();

    expect(cache.get('/a')).toBe('');
    // The unrelated key survives: this is a logout purge, not an "empty the
    // browser" button.
    expect(store.get('loggedIn')).toBe('true');
  });

  it('survives a store with no clearPrefixed', () => {
    const minimal = { get: () => null, set: () => {}, remove: () => {} };
    expect(() => createEtagCache({ store: minimal }).clear()).not.toThrow();
  });

  it('tolerates a store whose reads throw', () => {
    // Private browsing, disabled storage, a quota failure on write.
    const hostile = {
      get: () => { throw new Error('blocked'); },
      set: () => { throw new Error('blocked'); },
      remove: () => { throw new Error('blocked'); },
    };
    const c = createEtagCache({ store: hostile });
    // The adapter is what swallows these; asserting here documents that the
    // cache does not add its own guard and relies on the contract.
    expect(() => c.get('/a')).toThrow();
  });
});
