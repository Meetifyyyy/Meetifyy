/**
 * High-performance, lightweight process-level LRU (Least Recently Used) cache.
 * Serves as L1 Cache in front of Redis (L2) and PostgreSQL (L3).
 */
export class LruCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxSize: number = 5000,
    private readonly defaultTtlMs: number = 60000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number = this.defaultTtlMs): void {
    // Replacing a key must not push out a different, live one: the size does
    // not grow, so no room is needed. Deleting first also moves it to the
    // most-recently-used end.
    this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** Entries currently held, including any that have expired but not been read. */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Drops every expired entry. Expiry is otherwise noticed only when a key is
   * read, so a cache that is written but rarely read keeps dead entries until
   * the size cap pushes them out; callers that want the cap to hold only live
   * data call this on write.
   */
  pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
