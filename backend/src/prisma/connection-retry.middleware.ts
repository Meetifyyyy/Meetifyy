import { DatabaseUnavailableError } from './database-unavailable.error';
import { isRecord, stringField } from '../common/utils/type-guards.util';

/** How many times a query is retried after a transient connection failure. */
export const CONNECTION_RETRIES = 2;
const RETRY_DELAY_MS = 200;

/**
 * The connection was never made, or the pool never handed one out: the query
 * did not reach the database, so running it again cannot apply it twice.
 */
export function isConnectionNeverMade(error: unknown): boolean {
  const message = stringField(error, 'message') ?? '';
  const code = stringField(error, 'code');
  return (
    code === 'P1001' ||
    code === 'P1002' ||
    message.includes("Can't reach database server") ||
    message.includes('Timed out fetching a new connection') ||
    message.includes('Connection pool timeout') ||
    message.includes('EMAXCONNSESSION') ||
    message.includes('max clients reached') ||
    // The pooler refusing the connection: Postgres connection_failure (08006)
    // as the driver adapter reports it, and the socket's own wording
    // (MEETIFYY-API-6, -D, -E, -F in Sentry).
    message.includes('Failed to connect to database') ||
    /econnrefused/i.test(message)
  );
}

/**
 * The connection broke while the query was on it. The database may or may not
 * have run it, so only a query that changes nothing may be sent again: a
 * retried INSERT could insert twice (MEETIFYY-API-B was one of these).
 */
export function isConnectionLost(error: unknown): boolean {
  const message = stringField(error, 'message') ?? '';
  const code = stringField(error, 'code');
  return (
    code === 'P1008' ||
    code === 'P1017' ||
    message.includes('ConnectionReset') ||
    message.includes('Connection terminated unexpectedly')
  );
}

/** Either kind of connection failure: nothing to do with the query itself. */
export function isTransientConnectionError(error: unknown): boolean {
  return isConnectionNeverMade(error) || isConnectionLost(error);
}

/** Prisma actions that only read: running one twice changes nothing. */
const READ_ACTIONS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Whether this failure may be retried for this query.
 *
 * Never inside a transaction: the transaction died with its connection, and a
 * retried statement would run outside it. Raw queries count as writes, since
 * $queryRaw can carry an INSERT as easily as a SELECT.
 */
export function mayRetry(error: unknown, params: unknown): boolean {
  if (isRecord(params) && params.runInTransaction === true) return false;
  if (isConnectionNeverMade(error)) return true;
  const action = isRecord(params) ? params.action : undefined;
  return (
    typeof action === 'string' &&
    READ_ACTIONS.has(action) &&
    isConnectionLost(error)
  );
}

/**
 * PrismaService's query middleware: retries a query whose connection failed
 * when that cannot apply it twice (see mayRetry), and refuses every query once
 * the database has been closed.
 *
 * Refusing means THROWING DatabaseUnavailableError. It used to resolve such a
 * query to `undefined`, which callers took for a result and crashed on far from
 * the cause (MEETIFYY-API-C, -G).
 */
export function connectionRetryMiddleware(deps: {
  isClosed: () => boolean;
  warn: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}) {
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  return async <P>(
    params: P,
    next: (params: P) => Promise<unknown>,
  ): Promise<unknown> => {
    if (deps.isClosed()) throw new DatabaseUnavailableError();
    let retries = CONNECTION_RETRIES;
    for (;;) {
      try {
        // Passed through untouched: a middleware sees every model's results.
        return await next(params);
      } catch (error: unknown) {
        const message = stringField(error, 'message') ?? '';
        if (
          deps.isClosed() ||
          message.includes('Cannot use a pool after calling end on the pool')
        ) {
          throw new DatabaseUnavailableError(error);
        }
        if (mayRetry(error, params) && retries > 0) {
          retries--;
          const code = stringField(error, 'code');
          deps.warn(
            `Database transient connection issue (${code || 'network'}). Retrying... (${retries} attempts remaining)`,
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }
  };
}
