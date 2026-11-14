import { IS_DEVELOPMENT, IS_PRODUCTION, bool, oneOf, str } from './env';

/**
 * Environment-dependent behaviour, gathered in one place.
 *
 * Code asks `config.features.enableDevEndpoints`, never
 * `process.env.NODE_ENV === 'development'` — so a staging box can turn a
 * development affordance on without pretending to be a development build.
 */
/** `value` when it is a positive number, otherwise `fallback`. */
export function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const featuresConfigValues = {
  /** `/dev/email/*` preview endpoints. Never available in production. */
  enableDevEndpoints: IS_PRODUCTION
    ? false
    : bool('FEATURE_DEV_ENDPOINTS', { default: 'true' }),
  /**
   * Shared secret for dev-only routes. When empty they are reachable from
   * loopback only, which is the normal local-development case.
   */
  devEndpointToken: str('DEV_ENDPOINT_TOKEN'),
  /** Verbose in-app debugging surfaces. */
  enableDebugTools: IS_PRODUCTION
    ? false
    : bool('FEATURE_DEBUG_TOOLS', { default: String(IS_DEVELOPMENT) }),
  /** Unreleased functionality that can be enabled per environment. */
  enableExperimentalFeatures: bool('FEATURE_EXPERIMENTAL', {
    default: 'false',
  }),
  /**
   * The ranked For You home feed. Off falls back to the chronological feed
   * with no client change, which is the escape hatch if ranking misbehaves.
   */
  feedRanking: bool('FEATURE_FEED_RANKING', { default: 'true' }),
  /**
   * The verification gate. Anything but the literal `false` keeps it on: the
   * exact rule the guard always applied, so moving the read here (ID-28)
   * changes no deployment's behaviour, and an unexpected value cannot fail
   * boot.
   */
  verificationEnforced: str('FEATURE_VERIFICATION_ENABLED') !== 'false',
  /**
   * Hours an unsubmitted verification upload is left alone before the
   * collector removes it. Anything not a positive number means 24, as before.
   */
  verificationAbandonedUploadHours: positiveOr(
    Number(str('VERIFICATION_ABANDONED_UPLOAD_HOURS')),
    24,
  ),
  // NOTE: `relaxedRateLimits` was removed deliberately. It defaulted to true
  // outside production, so every rate limit in the application was inert in
  // local development, dev, staging and CI — production was the only
  // environment where the limiters ever ran, which is why several of their bugs
  // went unnoticed for so long. Limits now apply identically everywhere; see
  // config/rate-limit.config.ts, where RATE_LIMIT_MODE=shadow provides a
  // measure-only rollout mode that is refused in production.
};

export const loggingConfigValues = {
  level: oneOf(
    'LOG_LEVEL',
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const,
    {
      default: IS_PRODUCTION ? 'info' : 'debug',
    },
  ),
  /** Human-readable pino-pretty output. Structured JSON in production. */
  pretty: bool('LOG_PRETTY', { default: String(!IS_PRODUCTION) }),
  /** Log every query, not only slow ones. */
  logQueries: bool('LOG_QUERIES', { default: String(IS_DEVELOPMENT) }),
};

export type FeaturesConfig = typeof featuresConfigValues;
export type LoggingConfig = typeof loggingConfigValues;
