/**
 * Sentry for the installed app (meetifyy-android, and meetifyy-ios if built):
 * the SDK half, a chunk of its own. Imported by platform/capacitor/sentryBoot.js
 * once the first screen is usable; see that file for when, and for how reports
 * made before then are kept.
 *
 * @sentry/capacitor wraps @sentry/react and ALSO starts the native SDK
 * (sentry-android, added to the Gradle build by the plugin on `cap sync`). So
 * the app reports both JavaScript errors from the WebView and native crashes
 * and ANRs from the Java/Kotlin side, under one release and environment, with
 * the device model and OS version attached by the native layer.
 *
 * Shares its rules with the website (shared/lib/sentryOptions.js) but not its
 * DSN: the app is its own Sentry project, configured by the build's own
 * environment file (.env for the debug APK, .env.production for release).
 */
// Named imports only (see platform/web/sentry.js for why).
import {
  addBreadcrumb,
  browserTracingIntegration,
  captureException,
  getClient,
  init,
  setTag,
  setUser,
  withScope,
} from '@sentry/capacitor';
import { init as reactInit } from '@sentry/react';
import { createSentryAdapter, installMonitoring } from '@shared/lib/monitoring';

/** How long the JavaScript client may take to appear after `init` (it waits on the native SDK). */
const CLIENT_WAIT_MS = 10_000;
const CLIENT_POLL_MS = 50;

/**
 * @sentry/capacitor's `init` returns at once but creates the JavaScript client
 * only after the native SDK has initialised, asynchronously (its `sdkInit`).
 * Anything handed to the SDK before then is dropped: the reports held since
 * boot, and any uncaught error, since its global handlers are not installed
 * yet either. So nothing is handed over until the client exists.
 */
function whenClientReady({ wait = CLIENT_WAIT_MS, poll = CLIENT_POLL_MS } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const client = getClient();
      if (client) resolve(client);
      else if (Date.now() - started >= wait) resolve(null);
      else setTimeout(check, poll);
    };
    check();
  });
}

/**
 * Starts the native and JavaScript SDKs and, once the JavaScript client is up,
 * hands the app's reporting facade to them, which delivers everything held
 * since boot.
 *
 * @param {object} options   from buildSentryOptions (sentryBoot.js decided it is on)
 * @param {'android'|'ios'} platform
 * @returns {Promise<boolean>} whether reporting is live
 */
export async function startCapacitorSentry(options, platform) {
  try {
    init(
      {
        ...options,
        enableNative: true,
        enableNativeCrashHandling: true,
        integrations: options.tracesSampleRate > 0 ? [browserTracingIntegration()] : [],
      },
      reactInit,
    );
    setTag('app', platform);
  } catch (err) {
    console.warn('[sentry] init failed; continuing without it', err);
    installMonitoring(null);
    return false;
  }
  const client = await whenClientReady();
  if (!client) {
    console.warn('[sentry] the SDK did not start; continuing without it');
    installMonitoring(null);
    return false;
  }
  installMonitoring(createSentryAdapter({ withScope, captureException, addBreadcrumb, setUser }));
  return true;
}
