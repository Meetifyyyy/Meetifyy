/**
 * Central frontend configuration.
 *
 *   import { config } from '@config';
 *   fetch(`${config.api.baseUrl}/api/posts`);
 *
 * Nothing in the app hardcodes a domain, port or key — every environment-varying
 * value is declared here and supplied by the active `.env.<mode>` file (locally)
 * or the deployment's environment variables (Vercel/preview/production).
 */
import { IS_DEV_BUILD, IS_PROD_BUILD, MODE, assertEnvValid, bool, csv, int, str, url } from './env';

// APP_ENV distinguishes staging from production, which both build with
// MODE=production. It falls back to the Vite mode everywhere else.
const appEnv = str('VITE_APP_ENV', { fallback: MODE });

const siteUrl = url('VITE_SITE_URL');
const apiUrl = url('VITE_API_URL', { requiredInProd: true });

const routePath = (name, fallback) => {
  const value = str(name, { fallback });
  return value.startsWith('/') ? value : `/${value}`;
};

const authPaths = {
  callback: routePath('VITE_AUTH_CALLBACK_PATH', '/auth/callback'),
  resetPassword: routePath('VITE_AUTH_RESET_PASSWORD_PATH', '/reset-password'),
  verifyEmail: routePath('VITE_AUTH_VERIFY_EMAIL_PATH', '/verify-email'),
};

export const config = {
  env: appEnv,
  isProduction: appEnv === 'production',
  isDevBuild: IS_DEV_BUILD,
  isProdBuild: IS_PROD_BUILD,

  app: {
    name: str('VITE_APP_NAME', { fallback: 'Meetifyy' }),
    /**
     * The app's own public base URL, used for links that must be absolute
     * (auth email redirects, share URLs). Falls back to the current origin so a
     * preview deployment is correct without extra configuration.
     */
    siteUrl: siteUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
    /**
     * Hostnames treated as "this app" when classifying a pasted link. The
     * current origin always counts; this list covers the app's other domains.
     */
    internalDomains: csv('VITE_INTERNAL_DOMAINS'),
    supportEmail: str('VITE_SUPPORT_EMAIL'),
  },

  api: {
    /** Absolute API origin. Empty means "derive from the current host". */
    baseUrl: apiUrl,
    /** Same-origin proxy path used when the direct API origin is unreachable. */
    proxyPrefix: str('VITE_API_PROXY_PREFIX', { fallback: '/_api' }),
    /**
     * Port the backend listens on when running alongside the frontend on a
     * developer machine or LAN device.
     */
    localPort: int('VITE_API_LOCAL_PORT', { fallback: 4000 }),
    /**
     * Whether a localhost/LAN page should talk to a backend on the same host
     * rather than to VITE_API_URL. On by default for dev builds only.
     */
    preferLocalBackend: bool('VITE_API_PREFER_LOCAL', { fallback: IS_DEV_BUILD }),
  },

  auth: {
    /**
     * Paths auth flows redirect back to. Kept configurable so a deployment can
     * move a route without a code change, and absolute-ised against siteUrl so
     * the same value works in an email link and an in-app navigation.
     */
    paths: authPaths,
    get resetPasswordUrl() {
      return `${config.app.siteUrl}${authPaths.resetPassword}`;
    },
    get callbackUrl() {
      return `${config.app.siteUrl}${authPaths.callback}`;
    },
    get verifyEmailUrl() {
      return `${config.app.siteUrl}${authPaths.verifyEmail}`;
    },
  },

  storage: {
    /**
     * Public origin media is served from (CDN or bucket public host). Used to
     * normalise absolute media URLs back to their storage key.
     */
    publicUrl: url('VITE_STORAGE_PUBLIC_URL'),
  },

  supabase: {
    url: url('VITE_SUPABASE_URL', { requiredInProd: true }),
    anonKey: str('VITE_SUPABASE_ANON_KEY', { requiredInProd: true }),
  },

  integrations: {
    sentryDsn: str('VITE_SENTRY_DSN'),
    analyticsId: str('VITE_ANALYTICS_ID'),
  },

  features: {
    /**
     * Informational only. Anything that actually GATES a dev-only lazy import
     * or block must use the `IS_DEV_BUILD` constant instead — see the note by
     * its re-export at the bottom of this file.
     */
    enableDevRoutes: IS_DEV_BUILD,
    enableDebugTools: IS_DEV_BUILD && bool('VITE_ENABLE_DEBUG_TOOLS', { fallback: true }),
    enableExperimental: bool('VITE_ENABLE_EXPERIMENTAL', { fallback: false }),
    /** Update-check polling is pointless against a dev server. */
    enableVersionCheck: bool('VITE_ENABLE_VERSION_CHECK', { fallback: !IS_DEV_BUILD }),
    /**
     * The PWA service worker ships in PRODUCTION BUILDS ONLY.
     *
     * This is gated on the app environment, not on `IS_DEV_BUILD`. That
     * distinction is the whole point: `IS_DEV_BUILD` is false for *any* built
     * bundle, so the previous `!IS_DEV_BUILD` fallback enabled the worker on
     * the development deployment too.
     *
     * A service worker there is an access-control hole, not just wasted cache.
     * The navigation route serves `/index.html` straight from the precache, so
     * an installed dev PWA renders the whole app shell with no network request
     * at all — and a request that is never made is a request Cloudflare Access
     * never sees. Users who installed the dev PWA kept getting in after Access
     * was switched on.
     *
     * Non-production builds now ship a self-unregistering tombstone worker
     * instead (see `scripts/generate-tombstone-sw.mjs`), so existing
     * installations tear themselves down rather than lingering forever.
     */
    enableServiceWorker: bool('VITE_ENABLE_SERVICE_WORKER', {
      fallback: appEnv === 'production',
    }),
  },
};

assertEnvValid();

/**
 * Build-time constants, re-exported so no module outside this folder touches
 * `import.meta.env` directly.
 *
 * `IS_DEV_BUILD` must stay a plain constant rather than a `config.*` property:
 * Vite replaces `import.meta.env.DEV` with a literal, and Rollup then folds this
 * binding away and drops the dev-only branches entirely. Reading the same flag
 * through the config object defeats that, and dev-only routes end up shipped in
 * the production bundle — so use this constant for anything that gates a lazy
 * import or a whole dev-only block.
 */
export { IS_DEV_BUILD, IS_PROD_BUILD, MODE } from './env';

export default config;
