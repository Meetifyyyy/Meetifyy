import { recordDbOperation } from '../common/request-context/request-context';

/**
 * Counts every Prisma operation, and the time it took, against the HTTP
 * request that made it (see request-context.ts).
 *
 * It is a query middleware rather than a `query` event handler or a wrapper
 * around the node-postgres pool because it is the only point that runs in the
 * caller's own async chain: Prisma's library engine calls back from native
 * code, where the request's AsyncLocalStorage is gone. A middleware also sees
 * raw queries and every statement inside an interactive or batch transaction.
 *
 * Registered before the retry middleware, so a query retried after a dropped
 * connection is one operation whose time includes the wait — the request waited
 * that long. Time is taken in `finally`, so a failing query is counted too.
 */
export function dbStatsMiddleware() {
  return async <P>(
    params: P,
    next: (params: P) => Promise<unknown>,
  ): Promise<unknown> => {
    const started = performance.now();
    try {
      return await next(params);
    } finally {
      recordDbOperation(performance.now() - started);
    }
  };
}
