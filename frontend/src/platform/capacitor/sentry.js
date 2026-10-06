/**
 * Sentry for the installed app (meetifyy-android, and meetifyy-ios if built).
 * Called by src/mobile/main.jsx before render.
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
  init,
  setTag,
  setUser,
  withScope,
} from '@sentry/capacitor';
import { init as reactInit } from '@sentry/react';
import { Capacitor } from '@capacitor/core';
import { buildSentryOptions } from '@shared/lib/sentryOptions';
import { createSentryAdapter, installMonitoring } from '@shared/lib/monitoring';

/**
 * @param {object} p
 * @param {object} p.config
 * @param {string} p.appVersion   <versionName>+<commit>, stamped at build time
 */
export function installCapacitorSentry({ config, appVersion }) {
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  const { options, disabledReason } = buildSentryOptions({
    sentry: config.integrations.sentry,
    environment: config.env,
    isProduction: config.isProduction,
    platform,
    release: appVersion ? `meetifyy-${platform}@${appVersion}` : '',
    apiOrigin: config.api.baseUrl,
  });

  if (!options) {
    if (config.isDevBuild) console.info(`[sentry] disabled: ${disabledReason}`);
    return false;
  }

  try {
    init(
      {
        ...options,
        // Native crash reporting and ANR detection come with the native SDK.
        enableNative: true,
        enableNativeCrashHandling: true,
        integrations: options.tracesSampleRate > 0 ? [browserTracingIntegration()] : [],
      },
      reactInit,
    );
    // Set through the scope (not just initialScope) so the native layer gets it
    // too: native crashes and ANRs are tagged with the app like JS errors are.
    setTag('app', platform);
    installMonitoring(createSentryAdapter({ withScope, captureException, addBreadcrumb, setUser }));
    return true;
  } catch (err) {
    console.warn('[sentry] init failed; continuing without it', err);
    return false;
  }
}
