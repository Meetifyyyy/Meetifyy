/**
 * Sentry for the website (meetifyy-web). Loaded LAZILY by src/main.jsx.
 *
 * This module is a separate chunk: @sentry/react with browser tracing is about
 * 50 KB gzipped, and putting it in the entry chunk would delay first paint on
 * every visit. main.jsx decides synchronously whether Sentry should run
 * (`planWebSentry`, from the pure options module) and, if so, buffers early
 * reports and imports this file once the page is idle. Errors raised before
 * then are held by the monitoring facade and replayed here.
 *
 * Page-load performance is still measured: browser tracing reads the
 * navigation and paint timings the browser already recorded.
 *
 * Never imported by the app build (the app uses platform/capacitor/sentry.js).
 */
// Named imports only. Passing the whole namespace object anywhere makes the
// bundler keep every export (Replay, Feedback, Canvas…) — 160 KB instead of 50.
import {
  addBreadcrumb,
  browserTracingIntegration,
  captureException,
  init,
  setUser,
  withScope,
} from '@sentry/react';
import { createSentryAdapter, installMonitoring } from '@shared/lib/monitoring';

/** @param {object} options  from buildSentryOptions(...).options */
export function startWebSentry(options) {
  try {
    init({
      ...options,
      integrations: options.tracesSampleRate > 0 ? [browserTracingIntegration()] : [],
    });
    installMonitoring(createSentryAdapter({ withScope, captureException, addBreadcrumb, setUser }));
    return true;
  } catch (err) {
    // A broken Sentry setup must never break the website.
    console.warn('[sentry] init failed; continuing without it', err);
    installMonitoring(null);
    return false;
  }
}
