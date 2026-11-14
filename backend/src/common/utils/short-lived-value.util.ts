/**
 * One value, computed at most once every `ttlMs`, with concurrent callers
 * sharing the computation already in flight. A failure is not kept: the next
 * call tries again.
 *
 * For read-mostly admin panels that several tabs poll (E-11): it bounds the
 * work to one computation per window per replica, whatever the number of
 * viewers. Per replica, in memory: nothing here is worth a Redis round trip.
 */
export class ShortLivedValue<T> {
  private entry: { at: number; value: Promise<T> } | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(compute: () => Promise<T>): Promise<T> {
    const at = this.now();
    if (this.entry && at - this.entry.at < this.ttlMs) return this.entry.value;
    const entry = { at, value: compute() };
    this.entry = entry;
    // Forget a failed computation so the next caller retries. The callers
    // still see the rejection through `entry.value`; this branch only clears.
    void entry.value.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return entry.value;
  }
}
