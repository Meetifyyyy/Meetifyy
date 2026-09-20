import {
  ALL_ENVIRONMENTS,
  APP_ENV,
  IS_PRODUCTION,
  IS_STAGING,
  bool,
  csv,
  int,
  num,
  str,
  url,
} from './env';

/**
 * Application-level configuration: identity, network binding, public URLs,
 * CORS and the security headers derived from them.
 */

const frontendUrl = url('FRONTEND_URL', { requiredIn: ALL_ENVIRONMENTS });
const backendUrl = url('BACKEND_URL', {
  requiredIn: ['staging', 'production'],
});
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

/**
 * The origin the installed app runs on, and the one exception to the rule
 * directly above.
 *
 * A Capacitor WebView serves the bundled app from a local scheme; with
 * `androidScheme`/`iosScheme` both set to `https` in `frontend/capacitor.config.json`,
 * that origin is exactly `https://localhost` on both platforms.
 *
 * WHY THIS IS NOT "a preview domain baked into the code"
 * It is not a deployment detail. It is decided by a file in this repository,
 * it is byte-identical in every environment, it belongs to no one and it can
 * never change without a source change landing beside it. Carrying it as an
 * environment variable would mean the production API rejects the shipped app
 * unless a human remembers to set it — which is not hypothetical: it is the
 * exact defect this constant was added to fix, found only because the app was
 * run against a real backend. A value that must be right in every environment
 * and is the same in every environment belongs in the code.
 *
 * WHAT ALLOWING IT DOES AND DOES NOT MEAN
 * It permits a page on `https://localhost` to READ this API's responses. It
 * does not authenticate that page. Session cookies are `SameSite=Strict`, so a
 * browser will not attach them from a cross-site localhost page at all — the
 * same rule that blocked the app's own cookies and forced the native client
 * onto session-bound bearer tokens. Those tokens live in the Keychain/Keystore
 * of the device, which no web page can read. So an origin being allowed here
 * is not an origin being trusted.
 *
 * Set NATIVE_APP_ORIGINS to override the list, or to an empty value to drop it.
 */
const DEFAULT_NATIVE_APP_ORIGINS = ['https://localhost'];
const nativeAppOrigins =
  process.env.NATIVE_APP_ORIGINS === undefined
    ? DEFAULT_NATIVE_APP_ORIGINS
    : csv('NATIVE_APP_ORIGINS');

// Every browser-facing origin this API serves is trusted by default, so a
// deployment that sets FRONTEND_URL/ADMIN_URL does not also have to repeat them
// in CORS_ORIGINS.
const allowedOrigins = Array.from(
  new Set(
    [frontendUrl, adminUrl, ...corsOrigins, ...nativeAppOrigins].filter(Boolean),
  ),
);

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
    /**
     * The subset of `origins` that is the installed app rather than a website.
     * Read by the auth controller, which returns session tokens in the response
     * body only to these origins — see `nativeAppOrigins` above.
     */
    nativeAppOrigins,
    /** Wildcard patterns (e.g. `https://*.meetifyy.app`) allowed in addition. */
    originPatterns: corsOriginPatterns,
    /**
     * Whether localhost / private-LAN origins are trusted. Defaults to on
     * outside production so LAN device testing works, and is forced off in
     * production regardless of the variable — a production API must never treat
     * a developer machine as same-trust.
     */
    allowLocalNetwork: IS_PRODUCTION
      ? false
      : bool('CORS_ALLOW_LOCAL_NETWORK', { default: 'true' }),
    credentials: true,
    /**
     * `Access-Control-Max-Age`: how long a browser may reuse one preflight
     * result before asking again.
     *
     * Every request this API serves carries an `Authorization` header, which
     * makes it non-simple, which means a separate `OPTIONS` round trip before
     * the real one. Without this header that preflight is not cacheable at all
     * and the doubled latency is paid on every single call — on a phone over
     * mobile data that is the difference between one RTT and two on each of the
     * eight or so requests a screen makes.
     *
     * 24 hours is the ceiling browsers will honour (Firefox); Chrome and Safari
     * clamp to their own shorter maximums, so this is a request, not a promise.
     * The value is deliberately not "as long as possible" for its own sake —
     * the cache holds the allowed methods and headers, so shortening it is the
     * lever if that policy ever needs to change quickly in an environment.
     */
    maxAge: int('CORS_MAX_AGE_SECONDS', {
      default: '86400',
      min: 0,
      max: 86400,
    }),
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
