/**
 * Test double for the transaction `joinActivity` runs its capacity-checked
 * insert in. The first statement of that transaction is a row lock on the
 * activity; it returns nothing the service reads, so here it resolves empty
 * without reaching the caller's `$queryRaw` mock. Everything else is forwarded,
 * which keeps a spec's "the insert was the first raw query" assertions about
 * the insert itself.
 */
export type RawQuery = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

export interface JoinTransactionClient {
  $queryRaw: RawQuery;
}

/** True for the `… FOR NO KEY UPDATE` statement that takes the activity lock. */
export function isActivityLock(strings: TemplateStringsArray): boolean {
  return strings.join(' ').includes('FOR NO KEY UPDATE');
}

export function joinTransaction(queryRaw: RawQuery) {
  const tx: JoinTransactionClient = {
    $queryRaw: (strings, ...values) =>
      isActivityLock(strings)
        ? Promise.resolve([])
        : queryRaw(strings, ...values),
  };
  return <T>(fn: (client: JoinTransactionClient) => Promise<T>): Promise<T> =>
    fn(tx);
}
