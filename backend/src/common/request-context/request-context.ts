import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { isRecord } from '../utils/type-guards.util';

/**
 * What one HTTP request has asked of the database so far.
 *
 * `queries` counts Prisma operations (a `findMany`, an `$executeRaw`, each
 * statement of a `$transaction`), not SQL round trips: BEGIN/COMMIT around a
 * transaction are not counted, and an operation Prisma splits into several
 * statements is counted once. `dbMs` is the SUM of those operations' wall
 * times, so queries a handler runs in parallel add up to more than the time the
 * request actually waited. Both are for comparing one build against another
 * on the same route, which is what they are stable enough for.
 */
export interface RequestDbStats {
  queries: number;
  dbMs: number;
}

/**
 * Where the current request's counters live.
 *
 * AsyncLocalStorage follows the async call chain of whoever entered it, so two
 * requests in flight at once each see their own object. It does NOT follow
 * callbacks that native code invokes on its own thread: Prisma's `query` event
 * and the node-postgres calls its engine makes through the driver adapter both
 * arrive with no store at all (measured against the real library engine), which
 * is why counting happens in a Prisma middleware, in the caller's own chain.
 */
const storage = new AsyncLocalStorage<RequestDbStats>();

/**
 * The same counters keyed by the request object, for the code that runs after
 * the response is written (the access log) or far from the async chain (the
 * exception filter), where reaching the store is not guaranteed.
 */
const byRequest = new WeakMap<object, RequestDbStats>();

/** Run `fn` with a fresh set of counters; everything it awaits shares them. */
export function runWithDbStats<T>(
  fn: () => T,
  stats: RequestDbStats = { queries: 0, dbMs: 0 },
): T {
  return storage.run(stats, fn);
}

/**
 * Attribute one finished database operation to the request that issued it.
 * Outside a request (a queue worker, a socket handler, the keep-alive ping)
 * there is no store, and the operation is simply not counted.
 */
export function recordDbOperation(ms: number): void {
  const stats = storage.getStore();
  if (!stats) return;
  stats.queries += 1;
  stats.dbMs += ms;
}

/** The counters of a request, from either request shape pino hands out. */
export function requestDbStats(req: unknown): RequestDbStats | undefined {
  const find = (candidate: unknown) =>
    typeof candidate === 'object' && candidate !== null
      ? byRequest.get(candidate)
      : undefined;
  return find(req) ?? find(isRecord(req) ? req.raw : undefined);
}

/** `Server-Timing` value for a request's counters: `db;dur=12.3;desc="4 queries"`. */
export function serverTimingValue(stats: RequestDbStats): string {
  const queries = stats.queries;
  return `db;dur=${stats.dbMs.toFixed(1)};desc="${queries} ${queries === 1 ? 'query' : 'queries'}"`;
}

/**
 * Opens the request's counters. Registered first in `main.ts`, ahead of the
 * body parser, the guards and the logger, so every query a request causes has
 * somewhere to land. `storage.run(…, next)` rather than `enterWith`: the store
 * is bound to this request's chain, and cannot leak into the next request
 * served on the same socket.
 *
 * With `serverTiming` the totals are written into a `Server-Timing` header,
 * which browsers show in the network panel. It is for development and staging;
 * production leaves it off, since a response header is also a statement to
 * every client about how the server spent its time.
 *
 * The header has to be added before the headers go out, and nothing after that
 * can add one: `res.on('finish')` fires once the response is already written.
 * An interceptor sees only handler results, so a guard rejection or an
 * exception-filter response would miss it. Node writes the head through
 * `res.writeHead` on EVERY path — an explicit call, `res.end()` with an
 * implicit head, an error response — so that is the one place guaranteed to run
 * after the last query a request makes and before the first byte is sent.
 */
export function requestContextMiddleware(options: { serverTiming: boolean }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const stats: RequestDbStats = { queries: 0, dbMs: 0 };
    byRequest.set(req, stats);

    if (options.serverTiming) {
      const writeHead = res.writeHead.bind(res);
      res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
        if (!res.headersSent) {
          res.setHeader('Server-Timing', serverTimingValue(stats));
        }
        return writeHead(...args);
      }) as Response['writeHead'];
    }

    storage.run(stats, next);
  };
}
