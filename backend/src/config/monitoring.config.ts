import { bool, csv, int, num, str } from './env';

/**
 * Application monitoring configuration.
 *
 * Single source of truth for every environment-driven monitoring setting. No
 * other file in the monitoring feature reads `process.env`, and none of them
 * branch on which environment they are running in.
 *
 * That is the whole point: promoting this feature from development to
 * production is a change of variable *values*, never a change of code. A
 * `NODE_ENV === 'production'` check would make the deployed behaviour something
 * that cannot be reproduced or tested anywhere else, so instead the same code
 * path runs everywhere and the numbers differ - a lower sample rate and a
 * shorter poll interval in production, full capture in development.
 *
 * Nothing here is specific to a hosting provider. The collectors read Node,
 * Postgres and Socket.IO primitives only, so moving off the current host
 * changes nothing in this feature.
 */

/**
 * Fields that must never reach the monitoring tables, whatever else is
 * configured. REDACT_FIELDS is merged on top of this rather than replacing it,
 * so a deployment can add to the denylist but cannot shrink it below the safe
 * minimum by setting the variable.
 */
const ALWAYS_REDACTED = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'api_key',
  'secret',
  'otp',
  'totp',
  'sessionid',
  'x-csrf-token',
];

export const monitoringConfigValues = {
  /** Master switch. Off disables collection entirely; the admin API still reads history. */
  enabled: bool('MONITORING_ENABLED', { default: 'true' }),

  /**
   * Fraction of successful requests recorded, 0 to 1.
   *
   * Errors and slow requests bypass this and are always recorded - a sampled
   * error log is worse than none, because it makes a real incident look
   * intermittent.
   */
  sampleRate: num('LOG_SAMPLE_RATE', { default: '1.0', min: 0, max: 1 }),

  /** Requests at or above this duration are always recorded, whatever the sample rate. */
  slowRequestMs: int('SLOW_REQUEST_MS', { default: '1000', min: 1 }),

  /** How often a system snapshot is taken. */
  metricsIntervalMs: int('METRICS_INTERVAL_MS', {
    default: '15000',
    min: 1000,
  }),

  /**
   * Rows are buffered and flushed together so a request never waits on a
   * monitoring insert. The buffer also drains on this interval, so a quiet
   * period does not leave rows sitting unwritten.
   */
  flushIntervalMs: int('MONITORING_FLUSH_INTERVAL_MS', {
    default: '5000',
    min: 250,
  }),
  flushBatchSize: int('MONITORING_FLUSH_BATCH_SIZE', {
    default: '50',
    min: 1,
    max: 1000,
  }),

  /**
   * Hard ceiling on buffered rows. If the database is unreachable the buffer
   * is dropped oldest-first rather than growing until the process runs out of
   * memory: monitoring must never be the thing that takes the app down.
   */
  maxBufferedRows: int('MONITORING_MAX_BUFFERED_ROWS', {
    default: '5000',
    min: 100,
  }),

  /** Rows older than this are deleted by the retention job. */
  retentionDays: int('LOG_RETENTION_DAYS', { default: '14', min: 1 }),

  /** How often the retention job runs. */
  retentionIntervalMs: int('LOG_RETENTION_INTERVAL_MS', {
    default: String(6 * 60 * 60 * 1000),
    min: 60_000,
  }),

  /**
   * Whether stack traces are stored on error rows. A stack can quote a source
   * line that contains a value, so it is opt-in and admin-only on read.
   */
  logStackTraces: bool('LOG_STACK_TRACES', { default: 'false' }),

  /** Extra denylist entries, merged with ALWAYS_REDACTED above. */
  redactFields: Array.from(
    new Set([
      ...ALWAYS_REDACTED,
      ...csv('REDACT_FIELDS').map((f) => f.toLowerCase()),
    ]),
  ),

  /** Route prefixes never recorded, so monitoring cannot log its own reads. */
  ignoredRoutePrefixes: csv('MONITORING_IGNORED_ROUTES').length
    ? csv('MONITORING_IGNORED_ROUTES')
    : ['/admin/monitoring', '/health', '/metrics', '/favicon.ico'],

  /** Dashboard poll interval, served to the client so it is configured in one place. */
  pollingIntervalMs: int('MONITORING_POLLING_INTERVAL_MS', {
    default: '15000',
    min: 2000,
  }),

  /** Rows per page in the admin log tables. */
  pageSize: int('MONITORING_PAGE_SIZE', { default: '50', min: 1, max: 200 }),

  /** Per-admin request budget for the monitoring API. */
  apiRateLimitPoints: int('MONITORING_RATE_LIMIT_POINTS', {
    default: '120',
    min: 1,
  }),
  apiRateLimitWindowSec: int('MONITORING_RATE_LIMIT_WINDOW_SEC', {
    default: '60',
    min: 1,
  }),

  /** Error-rate percentage above which the dashboard shows a degraded state. */
  errorRateWarningPercent: num('MONITORING_ERROR_RATE_WARNING', {
    default: '5',
    min: 0,
    max: 100,
  }),

  /** Average latency in ms above which the dashboard shows a degraded state. */
  latencyWarningMs: int('MONITORING_LATENCY_WARNING_MS', {
    default: '800',
    min: 1,
  }),

  /** Label shown on the dashboard. Free text; never used for a decision. */
  environmentLabel: str('MONITORING_ENVIRONMENT_LABEL', { default: '' }),
};

export type MonitoringConfig = typeof monitoringConfigValues;
