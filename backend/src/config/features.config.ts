import { IS_DEVELOPMENT, IS_PRODUCTION, bool, oneOf, str } from './env';

/**
 * Environment-dependent behaviour, gathered in one place.
 *
 * Code asks `config.features.enableDevEndpoints`, never
 * `process.env.NODE_ENV === 'development'` — so a staging box can turn a
 * development affordance on without pretending to be a development build.
 */
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
