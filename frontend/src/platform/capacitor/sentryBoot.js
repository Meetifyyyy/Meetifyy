/**
 * The eager half of the installed app's Sentry setup: tiny, in the entry chunk.
 * The same split as the website's (platform/web/sentryBoot.js).
 *
 * WHY THE SDK IS NOT IN THE ENTRY CHUNK
 * @sentry/capacitor, @sentry/react and their core were about a fifth of the
 * app's entry chunk, which the WebView parses and compiles from scratch on
 * every cold start (no code cache reaches a bundled app). And starting it at
 * boot put its native init — a few hundred milliseconds on Capacitor's single
 * plugin thread — in front of the Keystore reads that decide who is signed in.
 * Neither is needed to show the first screen.
 *
 * WHAT IS KEPT FROM THE FIRST LINE OF BOOT
 * This decides whether Sentry runs at all (shared/lib/sentryOptions.js), and if
 * it does: reports made through the app's facade (error boundaries, the API
 * client, captureError anywhere) are held, and uncaught errors and unhandled
 * rejections are caught and held too. All of it is delivered when the SDK
 * starts. Before this, the SDK's own JavaScript half only began once its
 * native init had finished, so errors in that first stretch were not reported
 * at all; now they are held and sent.
 *
 * WHAT STARTS LATER
 * The SDK chunk is imported, and the native SDK started, when `load()` is
 * called: by mobile/main.jsx once the first screen is fully drawn and the page
 * is idle, or at a cap. Native crashes (Java and NDK) are caught from then on,
 * a second or two into a cold start instead of about one: a native crash in
 * that window is not reported. Documented in docs/sentry.md.
 */
import { Capacitor } from '@capacitor/core';
import { IS_DEV_SERVER } from '@config';
import { buildSentryOptions } from '@shared/lib/sentryOptions';
import { bufferUntilInstalled, captureError, stopBuffering } from '@shared/lib/monitoring';

/**
 * @param {object} p
 * @param {object} p.config
 * @param {string} p.appVersion   <versionName>+<commit>, stamped at build time
 * @param {() => Promise<{ startCapacitorSentry: Function }>} [p.loadSdk]  the SDK chunk
 * @param {boolean} [p.isDevServer]  served by Vite's dev server, e.g. live reload (stays off unless asked)
 * @returns {(() => void) | null}  starts the SDK (idempotent), or null when Sentry is off
 */
export function bootCapacitorSentry({
  config,
  appVersion,
  loadSdk = () => import('./sentry'),
  isDevServer = IS_DEV_SERVER,
}) {
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  const { options, disabledReason } = buildSentryOptions({
    sentry: config.integrations.sentry,
    environment: config.env,
    isProduction: config.isProduction,
    platform,
    release: appVersion ? `meetifyy-${platform}@${appVersion}` : '',
    apiOrigin: config.api.baseUrl,
    isDevServer,
  });

  if (!options) {
    if (config.isDevBuild) console.info(`[sentry] disabled: ${disabledReason}`);
    return null;
  }

  // Until the SDK is in, uncaught errors go through the facade's buffer. The
  // SDK installs its own global handlers on init, so these come off first —
  // nothing is reported twice.
  bufferUntilInstalled();
  const onError = (event) => captureError(event.error || new Error(String(event.message)));
  const onRejection = (event) => captureError(event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const removeEarlyHandlers = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };

  let started = false;
  return function load() {
    if (started) return;
    started = true;
    Promise.resolve()
      .then(loadSdk)
      // Resolves once the SDK's client is up and holding nothing back; the
      // early handlers stay until then, so no uncaught error falls between
      // the two.
      .then(({ startCapacitorSentry }) => startCapacitorSentry(options, platform))
      .then(removeEarlyHandlers, () => {
        // The chunk could not load: run without monitoring rather than holding
        // reports forever.
        removeEarlyHandlers();
        stopBuffering();
      });
  };
}
