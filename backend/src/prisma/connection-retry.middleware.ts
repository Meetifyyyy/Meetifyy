import { DatabaseUnavailableError } from './database-unavailable.error';
import { stringField } from '../common/utils/type-guards.util';

/** How many times a query is retried after a transient connection failure. */
export const CONNECTION_RETRIES = 2;
const RETRY_DELAY_MS = 200;

/**
 * A failure that says nothing about the query, only that the connection to the
 * database broke or could not be made — so the same query may succeed a moment
 * later on another connection.
 */
export function isTransientConnectionError(error: unknown): boolean {
  const message = stringField(error, 'message') ?? '';
  const code = stringField(error, 'code');
  return (
    code === 'P1001' ||
    code === 'P1002' ||
    code === 'P1008' ||
    code === 'P1017' ||
    message.includes("Can't reach database server") ||
    message.includes('Timed out fetching a new connection') ||
    message.includes('Connection pool timeout') ||
    message.includes('EMAXCONNSESSION') ||
    message.includes('max clients reached') ||
    message.includes('ConnectionReset') ||
    // The pooler refusing or dropping the connection: Postgres
    // connection_failure (08006) as the driver adapter reports it, and pg's own
    // wording. A blip retries like the cases above; an outage still fails after
    // the retries (MEETIFYY-API-6, -B, -D, -E, -F in Sentry).
    message.includes('Failed to connect to database') ||
    message.includes('Connection terminated unexpectedly') ||
    /econnrefused/i.test(message)
  );
}

/**
 * PrismaService's query middleware: retries transient connection failures, and
 * refuses every query once the database has been closed.
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
        if (isTransientConnectionError(error) && retries > 0) {
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
