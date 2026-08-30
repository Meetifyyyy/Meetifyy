import { LruCache } from './lru-cache.util';

describe('LruCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Basic get / set ───────────────────────────────────────────────────────

  describe('get and set', () => {
    it('stores and retrieves a value', () => {
      const cache = new LruCache<string, number>(10, 60_000);
      cache.set('a', 42);
      expect(cache.get('a')).toBe(42);
    });

    it('returns undefined for an unknown key', () => {
      const cache = new LruCache<string, string>();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('overwrites an existing key', () => {
      const cache = new LruCache<string, number>();
      cache.set('x', 1);
      cache.set('x', 2);
      expect(cache.get('x')).toBe(2);
    });
  });

  // ── TTL expiry ────────────────────────────────────────────────────────────

  describe('TTL expiry', () => {
    it('returns undefined after the default TTL has elapsed', () => {
      const ttlMs = 5000;
      const cache = new LruCache<string, string>(10, ttlMs);
      cache.set('key', 'value');
      jest.advanceTimersByTime(ttlMs + 1);
      expect(cache.get('key')).toBeUndefined();
    });

    it('returns the value before the TTL has elapsed', () => {
      const ttlMs = 5000;
      const cache = new LruCache<string, string>(10, ttlMs);
      cache.set('key', 'value');
      jest.advanceTimersByTime(ttlMs - 1);
      expect(cache.get('key')).toBe('value');
    });

    it('honours a per-entry TTL override', () => {
      const cache = new LruCache<string, string>(10, 60_000);
      cache.set('short', 'v', 1000);
      jest.advanceTimersByTime(1001);
      expect(cache.get('short')).toBeUndefined();
    });
  });

  // ── LRU eviction ─────────────────────────────────────────────────────────

  describe('LRU eviction', () => {
    it('evicts the oldest entry when the capacity is full', () => {
      const cache = new LruCache<string, number>(3, 60_000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // 'a' is the oldest — adding 'd' should evict it.
      cache.set('d', 4);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('refreshes LRU position on get so the accessed entry survives eviction', () => {
      const cache = new LruCache<string, number>(3, 60_000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Touch 'a' so it moves to the most-recently-used position.
      cache.get('a');
      // Adding 'd' should evict 'b' (now oldest), not 'a'.
      cache.set('d', 4);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes an entry and returns true', () => {
      const cache = new LruCache<string, string>();
      cache.set('k', 'v');
      expect(cache.delete('k')).toBe(true);
      expect(cache.get('k')).toBeUndefined();
    });

    it('returns false when the key does not exist', () => {
      const cache = new LruCache<string, string>();
      expect(cache.delete('nope')).toBe(false);
    });
  });

  // ── clear ────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new LruCache<string, number>(10, 60_000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.clear();
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });
  });

  // ── Different value types ─────────────────────────────────────────────────

  describe('generic type support', () => {
    it('stores objects', () => {
      const cache = new LruCache<string, { x: number }>();
      cache.set('obj', { x: 99 });
      expect(cache.get('obj')).toEqual({ x: 99 });
    });

    it('stores numeric keys', () => {
      const cache = new LruCache<number, string>();
      cache.set(1, 'one');
      expect(cache.get(1)).toBe('one');
    });
  });
});
