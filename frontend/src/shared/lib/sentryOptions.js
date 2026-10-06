/**
 * The Sentry options for the website and the installed app, and the rules that
 * decide whether Sentry starts at all. Pure: no SDK import, so both platform
 * setups share it and the dev/prod rules are unit-tested here.
 *
 * DEVELOPMENT AND PRODUCTION NEVER MIX
 *  - `environment` is the build's own VITE_APP_ENV (config.env), never a
 *    separate value, so a development build cannot report as production.
 *  - VITE_SENTRY_ENVIRONMENT, if set, must equal it, or Sentry stays off.
 *  - On the website, a production build served from a development host (or the
 *    reverse) stays off: a mis-pointed deployment does not pollute the other
 *    environment's data.
 *  - The DSN comes from the environment file / Vercel project of THAT
 *    deployment; nothing is hardcoded and there is no fallback DSN.
 *
 * Missing configuration is not an error: no DSN means `{ options: null }` and
 * the app runs exactly as it would without Sentry.
 */
import { scrubBreadcrumb, scrubEvent, featureFromPath } from './sentryScrub';

/** Hosts that only ever serve the production website. */
const PRODUCTION_WEB_HOSTS = new Set(['meetifyy.app', 'www.meetifyy.app']);

/**
 * Noise that says nothing about the code: the browser itself, extensions, and
 * a device going offline mid-request (already shown to the user as such).
 */
export const IGNORED_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  'AbortError',
  'The user aborted a request',
  'Request timed out. Please check your connection and try again.',
  /^TypeError: (Failed to fetch|NetworkError when attempting to fetch resource\.|Load failed)$/,
  'Non-Error promise rejection captured',
];

const EXTENSION_URLS = [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//];

/**
 * @param {object} p
 * @param {object} p.sentry          config.integrations.sentry
 * @param {string} p.environment     config.env (VITE_APP_ENV)
 * @param {boolean} p.isProduction   config.isProduction
 * @param {'web'|'android'|'ios'} p.platform
 * @param {string} p.release         e.g. meetifyy-web@<sha>
 * @param {string} [p.hostname]      website only
 * @param {boolean} [p.isNonProductionHost]
 * @param {string} [p.apiOrigin]     for trace propagation
 * @returns {{ options: object|null, disabledReason: string|null }}
 */
export function buildSentryOptions({
  sentry,
  environment,
  isProduction,
  platform,
  release,
  hostname = '',
  isNonProductionHost = false,
  apiOrigin = '',
}) {
  const off = (disabledReason) => ({ options: null, disabledReason });

  if (!sentry?.enabled) return off('VITE_SENTRY_ENABLED=false');
  if (!sentry?.dsn) return off(platform === 'web' ? 'no VITE_SENTRY_DSN' : 'no VITE_SENTRY_ANDROID_DSN');
  if (sentry.expectedEnvironment && sentry.expectedEnvironment !== environment) {
    return off(`VITE_SENTRY_ENVIRONMENT (${sentry.expectedEnvironment}) does not match VITE_APP_ENV (${environment})`);
  }
  if (platform === 'web' && hostname) {
    const host = hostname.toLowerCase();
    if (isProduction && isNonProductionHost) {
      return off(`production build on a non-production host (${host})`);
    }
    if (!isProduction && PRODUCTION_WEB_HOSTS.has(host)) {
      return off(`${environment} build on the production host (${host})`);
    }
  }

  const options = {
    dsn: sentry.dsn,
    environment,
    release: release || undefined,
    sendDefaultPii: false,
    tracesSampleRate: sentry.tracesSampleRate,
    tracePropagationTargets: sentry.propagateTraces && apiOrigin ? [apiOrigin] : [],
    // Recorded and replayed sessions would capture what people read and type
    // on a social app. Not enabled.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    ignoreErrors: IGNORED_ERRORS,
    denyUrls: EXTENSION_URLS,
    maxBreadcrumbs: 50,
    initialScope: {
      tags: { app: platform === 'web' ? 'web' : platform },
    },
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    beforeSend: (event) => {
      const path = typeof window !== 'undefined' ? window.location?.pathname : '';
      event.tags = { ...event.tags, feature: event.tags?.feature || featureFromPath(path) };
      return scrubEvent(event);
    },
    beforeSendTransaction: (event) => scrubEvent(event),
  };

  return { options, disabledReason: null };
}
