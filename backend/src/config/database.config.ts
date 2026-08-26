import { ALL_ENVIRONMENTS, IS_PRODUCTION, invariant, int, str } from './env';

/**
 * Database connection configuration.
 *
 * The application never chooses a database — the environment does. Repositories,
 * services and migrations are identical everywhere; only DATABASE_URL differs.
 *
 * DATABASE_URL   → runtime connections (transaction-mode pooler in this setup)
 * DIRECT_URL     → migrations (session-mode pooler / direct host)
 */

const databaseUrl = str('DATABASE_URL', { requiredIn: ALL_ENVIRONMENTS });
const directUrl = str('DIRECT_URL') || databaseUrl;

// A production connection string reaching a development process (or the reverse)
// is the single most expensive configuration mistake available, so it is checked
// rather than assumed.
invariant(
  !databaseUrl ||
    databaseUrl.startsWith('postgres://') ||
    databaseUrl.startsWith('postgresql://'),
  'Invalid DATABASE_URL: must be a postgres:// or postgresql:// connection string',
);

export const databaseConfigValues = {
  url: databaseUrl,
  directUrl,
  /** Slow-query threshold (ms) above which a query is logged as a warning. */
  slowQueryMs: int('DB_SLOW_QUERY_MS', { default: '500', min: 1 }),
  /** Retries for transient connection drops before an error surfaces. */
  connectionRetries: int('DB_CONNECTION_RETRIES', {
    default: '3',
    min: 0,
    max: 10,
  }),
  /**
   * Destructive seeding wipes every table. It is refused in production unless
   * this is explicitly turned on, so `prisma db seed` can never be the command
   * that empties the live database.
   */
  allowDestructiveSeed:
    !IS_PRODUCTION || str('ALLOW_DESTRUCTIVE_SEED').toLowerCase() === 'true',
};

export type DatabaseConfig = typeof databaseConfigValues;
