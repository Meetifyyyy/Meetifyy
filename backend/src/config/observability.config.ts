import { bool, int, str, url } from './env';

/**
 * Slow-request capture.
 *
 * The replacement for the removed monitoring subsystem, and deliberately far
 * smaller than it: one table, one middleware, one nightly prune. Nothing here
 * samples, estimates, or accepts a timing from a client — a row is written only
 * because a request measurably took this long on this server.
 */

/** Routes whose own reads must never become the thing that fills the table. */
const DEFAULT_IGNORED_PREFIXES = [
  '/admin/analytics',
  '/health',
  '/metrics',
  '/favicon.ico',
];

const csv = (name: string, fallback: string[]): string[] => {
  const raw = str(name);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

export const observabilityConfigValues = {
  slowRequests: {
    /**
     * Capture can be turned off without a redeploy. It stays on by default:
     * the whole point is to have the record already when someone asks why a
     * page was slow yesterday.
     */
    enabled: bool('SLOW_REQUEST_CAPTURE_ENABLED', { default: 'true' }),

    /**
     * A request at or above this many milliseconds is recorded.
     *
     * 500 ms is the agreed line. Raising it hides regressions; lowering it on a
     * remote database (where ~200 ms is round-trip cost alone) turns routine
     * traffic into rows.
     */
    thresholdMs: int('SLOW_REQUEST_THRESHOLD_MS', {
      default: '500',
      min: 1,
    }),

    /**
     * Rows older than this are deleted by the retention sweep, so the table
     * cannot grow without bound.
     */
    retentionDays: int('SLOW_REQUEST_RETENTION_DAYS', {
      default: '7',
      min: 1,
      max: 90,
    }),

    /**
     * Ceiling on rows written per sweep interval.
     *
     * A total outage makes every request slow; without a cap the first minutes
     * of an incident would write a row per request and turn the observability
     * table into a second incident. Excess is counted and logged, not stored.
     */
    maxPerMinute: int('SLOW_REQUEST_MAX_PER_MINUTE', {
      default: '120',
      min: 1,
    }),

    /** Prefixes that are never recorded. */
    ignoredPrefixes: csv(
      'SLOW_REQUEST_IGNORED_PREFIXES',
      DEFAULT_IGNORED_PREFIXES,
    ),
  },

  /**
   * Application error capture, for the admin Error Logs view.
   *
   * Same discipline as slow requests, for the same reason: a diagnostic that
   * can slow a request down or fill a database is worse than no diagnostic.
   */
  errorLogs: {
    /**
     * On by default. The point is to already have the record when someone asks
     * what broke on Tuesday, and a switch that has to be flipped after the
     * incident is not that.
     */
    enabled: bool('ERROR_LOG_CAPTURE_ENABLED', { default: 'true' }),

    /**
     * Rows older than this are deleted by the retention sweep.
     *
     * Seven days is the window the admin view offers. Keeping more would mean
     * storing errors nothing reads, and these rows carry request paths and user
     * ids - the less of that is kept, the better.
     */
    retentionDays: int('ERROR_LOG_RETENTION_DAYS', {
      default: '7',
      min: 1,
      max: 90,
    }),

    /**
     * Ceiling on rows written per minute.
     *
     * An outage produces errors at exactly the rate the app receives traffic.
     * Without a cap, the first minute of a database failure would try to write
     * one row per request TO THAT DATABASE, turning a fault into a second one.
     * Excess is counted and logged, never stored.
     */
    maxPerMinute: int('ERROR_LOG_MAX_PER_MINUTE', {
      default: '120',
      min: 1,
    }),

    /**
     * Whether deliberate 4xx responses are recorded.
     *
     * Off by default: a validation failure or a 401 is the API working, and
     * recording them buries the 500s that are not. 404 and 401 alone would
     * dwarf everything worth reading.
     */
    captureClientErrors: bool('ERROR_LOG_CAPTURE_CLIENT_ERRORS', {
      default: 'false',
    }),

    /** Prefixes that are never recorded. */
    ignoredPrefixes: csv('ERROR_LOG_IGNORED_PREFIXES', DEFAULT_IGNORED_PREFIXES),
  },
};

/**
 * Analytics probes.
 *
 * Every value the analytics page depends on is declared here, so moving from a
 * developer machine to production is an environment change and never a code
 * change. Nothing under `src/admin/analytics` reads `process.env` directly.
 */
export const analyticsConfigValues = {
  /** How long any single outbound probe may take before it counts as down. */
  probeTimeoutMs: int('ANALYTICS_PROBE_TIMEOUT_MS', {
    default: '4000',
    min: 250,
  }),

  /**
   * Cap on the R2 listing used to total stored bytes. Each page is 1,000
   * objects; past this the figure is reported as a partial scan rather than
   * walking an unbounded bucket on every page load.
   */
  r2MaxListPages: int('ANALYTICS_R2_MAX_LIST_PAGES', {
    default: '20',
    min: 1,
    max: 1000,
  }),

  /**
   * Path prefix that marks a request as belonging to the admin portal.
   *
   * The analytics page separates admin traffic from the public app because the
   * two have different owners and very different latency baselines: a 700 ms
   * admin list query is routine, while the same figure on a student-facing
   * route is a problem. Configurable so remounting the admin surface does not
   * require a code change.
   */
  adminRoutePrefix: str('ANALYTICS_ADMIN_ROUTE_PREFIX', { default: '/admin' }),

  /**
   * Resend's API root. Configurable so a proxy or a future API version does not
   * require a code change; the probe calls `/domains` beneath it, which is an
   * authenticated read that proves both reachability and that the key is valid.
   */
  resendApiUrl: url('RESEND_API_URL', { default: 'https://api.resend.com' }),

  /**
   * Credentials for the usage providers.
   *
   * Absent values are not an error — the page lists the provider as "not
   * reporting" and names the variables below rather than inventing figures.
   * Setting them in the deployment environment is all that is needed to turn
   * each panel on.
   */
  providers: {
    cloudflare: {
      apiToken: str('CLOUDFLARE_API_TOKEN'),
      accountId: str('CLOUDFLARE_ACCOUNT_ID') || str('R2_ACCOUNT_ID'),
    },
    vercel: {
      token: str('VERCEL_TOKEN'),
      teamId: str('VERCEL_TEAM_ID'),
    },
    azure: {
      tenantId: str('AZURE_TENANT_ID'),
      clientId: str('AZURE_CLIENT_ID'),
      clientSecret: str('AZURE_CLIENT_SECRET'),
      subscriptionId: str('AZURE_SUBSCRIPTION_ID'),
    },
  },
};

export type AnalyticsConfig = typeof analyticsConfigValues;

export type ObservabilityConfig = typeof observabilityConfigValues;
