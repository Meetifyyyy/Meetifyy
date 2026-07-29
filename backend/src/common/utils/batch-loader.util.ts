/**
 * BatchLoader coalesces multiple individual entity lookups requested within
 * the same event-loop tick into a single batched database query.
 * Eliminates N+1 query patterns automatically.
 */
export class BatchLoader<K, V> {
  private batch: K[] = [];
  private batchPromise: Promise<Map<K, V>> | null = null;
  private resolvers: Map<K, Array<(value: V | undefined) => void>> = new Map();

  constructor(
    private readonly batchFetchFn: (keys: K[]) => Promise<Map<K, V>>,
  ) {}

  load(key: K): Promise<V | undefined> {
    return new Promise((resolve) => {
      if (!this.resolvers.has(key)) {
        this.resolvers.set(key, []);
        this.batch.push(key);
      }
      this.resolvers.get(key)!.push(resolve);

      if (!this.batchPromise) {
        this.batchPromise = Promise.resolve().then(() => this.dispatch());
      }
    });
  }

  private async dispatch(): Promise<Map<K, V>> {
    const keys = [...this.batch];
    const currentResolvers = new Map(this.resolvers);

    this.batch = [];
    this.batchPromise = null;
    this.resolvers.clear();

    try {
      const results = await this.batchFetchFn(keys);
      currentResolvers.forEach((resolverFns, key) => {
        const val = results.get(key);
        resolverFns.forEach((fn) => fn(val));
      });
      return results;
    } catch (err) {
      currentResolvers.forEach((resolverFns) => {
        resolverFns.forEach((fn) => fn(undefined));
      });
      return new Map();
    }
  }
}
