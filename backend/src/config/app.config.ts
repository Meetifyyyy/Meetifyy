import { ALL_ENVIRONMENTS, APP_ENV, IS_PRODUCTION, IS_STAGING, bool, csv, int, num, str, url } from './env';

/**
 * Application-level configuration: identity, network binding, public URLs,
 * CORS and the security headers derived from them.
 */

const frontendUrl = url('FRONTEND_URL', { requiredIn: ALL_ENVIRONMENTS });
const backendUrl = url('BACKEND_URL', { requiredIn: ['staging', 'production'] });
const adminUrl = url('ADMIN_URL');

// The API base is derived from BACKEND_URL unless explicitly overridden — one
// fewer value to keep in step across environments.
//
// No `/api` suffix is appended: main.ts never calls setGlobalPrefix, so the
// routes are served at the root (`/health`, not `/api/health`). The suffix
// produced a base URL that 404s for every path, which the startup banner then
// printed as the API address. Deployments that really do sit behind an `/api`
// path can still say so with API_BASE_URL.
const apiBaseUrl = url('API_BASE_URL') || backendUrl;

// CORS_ORIGINS is the authoritative allow-list. Nothing is baked into the code:
// a new preview domain is a variable change, not a deploy of new source.
const corsOrigins = csv('CORS_ORIGINS');
const corsOriginPatterns = csv('CORS_ORIGIN_PATTERNS');

// Every browser-facing origin this API serves is trusted by default, so a
// deployment that sets FRONTEND_URL/ADMIN_URL does not also have to repeat them
// in CORS_ORIGINS.
const allowedOrigins = Array.from(new Set([frontendUrl, adminUrl, ...corsOrigins].filter(Boolean)));

export const appConfigValues = {
  env: APP_ENV,
  name: str('APP_NAME', { default: 'Meetifyy' }),
  version: str('APP_VERSION', { default: '0.9.0' }),
  isProduction: IS_PRODUCTION,
  isStaging: IS_STAGING,

  host: str('HOST', { default: '0.0.0.0' }),
  port: int('PORT', { default: '4000', min: 1, max: 65535 }),

  frontendUrl,
  backendUrl,
  apiBaseUrl,
  adminUrl,

  cors: {
    /** Exact origins that are always allowed. */
    origins: allowedOrigins,
    /** Wildcard patterns (e.g. `https://*.meetifyy.app`) allowed in addition. */
    originPatterns: corsOriginPatterns,
    /**
     * Whether localhost / private-LAN origins are trusted. Defaults to on
     * outside production so LAN device testing works, and is forced off in
     * production regardless of the variable — a production API must never treat
     * a developer machine as same-trust.
     */
    allowLocalNetwork: IS_PRODUCTION ? false : bool('CORS_ALLOW_LOCAL_NETWORK', { default: 'true' }),
    credentials: true,
  },

  security: {
    /** Content-Security-Policy is only emitted when enabled (default: production only). */
    cspEnabled: bool('CSP_ENABLED', { default: String(IS_PRODUCTION) }),
    cspScriptSrc: csv('CSP_SCRIPT_SRC'),
    cspStyleSrc: csv('CSP_STYLE_SRC'),
    cspFontSrc: csv('CSP_FONT_SRC'),
    cspImgSrc: csv('CSP_IMG_SRC'),
    cspConnectSrc: csv('CSP_CONNECT_SRC'),
    hstsEnabled: bool('HSTS_ENABLED', { default: String(IS_PRODUCTION) }),
  },

  observability: {
    sentryDsn: str('SENTRY_DSN'),
    sentryTracesSampleRate: num('SENTRY_TRACES_SAMPLE_RATE', {
      default: IS_PRODUCTION ? '0.1' : '1.0',
      min: 0,
      max: 1,
    }),
    sentryProfilesSampleRate: num('SENTRY_PROFILES_SAMPLE_RATE', {
      default: IS_PRODUCTION ? '0.05' : '1.0',
      min: 0,
      max: 1,
    }),
  },
};

export type AppConfig = typeof appConfigValues;
