/**
 * Which deployment this bundle is running as — the single rule, shared by
 * build-time and runtime.
 *
 * This exists because the same question was being answered three different ways
 * and one of them failed OPEN. `vite.config.js` and `scripts/generate-robots.mjs`
 * both required VITE_APP_ENV to be exactly "production", so an unset variable
 * fell to the safe side. `config/index.js` compared against a value that falls
 * back to Vite's MODE — which is "production" for *any* built bundle — so the
 * development deployment enabled its service worker while the build had already
 * (correctly) emitted a self-destructing tombstone worker instead.
 *
 * Indexing, worker registration and environment labelling are all opt-in: a
 * missing, empty or misspelled VITE_APP_ENV is NOT production.
 */

/** The literal value VITE_APP_ENV must hold for a deployment to be production. */
export const PRODUCTION_APP_ENV = 'production';

/**
 * Build-time check. `rawAppEnv` is the raw VITE_APP_ENV string.
 * Never falls back to MODE — that is the fail-open behaviour this replaces.
 */
export function isProductionAppEnv(rawAppEnv) {
  return String(rawAppEnv || '').trim().toLowerCase() === PRODUCTION_APP_ENV;
}

/**
 * Hostnames that are never the public production site.
 *
 * A second, independent gate on top of the build-time flag. Build-time
 * environment variables are exactly what proved unreliable here — they live in
 * a dashboard, they can be forgotten on a new project, and Vercel labels the
 * development project's own scope "Production", which invites setting
 * VITE_APP_ENV=production on precisely the deployment that must not have it.
 *
 * A caching worker on a Cloudflare Access-protected host is an access-control
 * hole: its cached shell renders without a network request for Access to
 * authorize. So the host is checked too, and either gate alone is enough to
 * refuse.
 *
 * This is a deny-list, so an unrecognised host is treated as production and
 * relies on the build-time flag. That is the correct bias: a false "this is
 * dev" would silently disable the PWA on the real site.
 */
const NON_PRODUCTION_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/,
  /\.local$/i,
  // Every Vercel-generated deployment URL, including per-commit previews.
  /\.vercel\.app$/i,
  // Non-production subdomains of the app's own domains.
  /^dev\./i,
  /^staging\./i,
  /^preview\./i,
  /^test\./i,
];

export function isNonProductionHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  return NON_PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(host));
}
