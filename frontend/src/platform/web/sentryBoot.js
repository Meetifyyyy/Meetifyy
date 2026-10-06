/**
 * The eager half of the website's Sentry setup: tiny, in the entry chunk.
 *
 * Decides whether Sentry runs (pure rules in shared/lib/sentryOptions.js), and
 * if it does: holds early reports, catches errors thrown before the SDK
 * arrives, and imports the SDK chunk (platform/web/sentry.js) once the page is
 * idle. If the decision is "off", nothing else happens at all.
 */
import { buildSentryOptions } from '@shared/lib/sentryOptions';
import { bufferUntilInstalled, captureError, stopBuffering } from '@shared/lib/monitoring';

function whenIdle(fn) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 4000 });
  } else {
    setTimeout(fn, 1500);
  }
}

/**
 * @param {object} p
 * @param {object} p.config
 * @param {boolean} p.isNonProductionHost
 * @param {string} p.release   meetifyy-web@<commit>, stamped at build time
 */
export function bootWebSentry({ config, isNonProductionHost, release }) {
  const { options, disabledReason } = buildSentryOptions({
    sentry: config.integrations.sentry,
    environment: config.env,
    isProduction: config.isProduction,
    platform: 'web',
    release,
    hostname: window.location.hostname,
    isNonProductionHost,
    apiOrigin: config.api.baseUrl,
  });

  if (!options) {
    if (config.isDevBuild) console.info(`[sentry] disabled: ${disabledReason}`);
    return false;
  }

  // Until the SDK is in, uncaught errors go through the facade's buffer. The
  // SDK installs its own global handlers on init, so these come off first —
  // nothing is ever reported twice.
  bufferUntilInstalled();
  const onError = (event) => captureError(event.error || new Error(String(event.message)));
  const onRejection = (event) => captureError(event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const removeEarlyHandlers = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };

  const load = () => {
    import('./sentry')
      .then(({ startWebSentry }) => {
        removeEarlyHandlers();
        startWebSentry(options);
      })
      .catch(() => {
        // The chunk could not load (offline, blocked by an extension): run
        // without monitoring rather than holding reports forever.
        removeEarlyHandlers();
        stopBuffering();
      });
  };

  if (document.readyState === 'complete') whenIdle(load);
  else window.addEventListener('load', () => whenIdle(load), { once: true });
  return true;
}
