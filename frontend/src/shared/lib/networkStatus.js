/**
 * Whether this device has a network, in one place.
 *
 * Three things used to answer that question separately: TanStack's
 * `onlineManager` (which in v5 STARTS as online whatever `navigator.onLine`
 * says, so a launch with no network looked connected), a few components reading
 * `navigator.onLine` directly, and the sockets listening to `online` on their
 * own. They disagreed, and "queries are paused" and "the UI knows it is
 * offline" could differ.
 *
 * Now there is one answer, `isOnline()`, and one subscription, `subscribeOnline`
 * (also `useOnlineStatus`). `installNetworkStatus` hands the same answer to
 * `onlineManager`, so queries pause and resume exactly when the UI says.
 *
 * `navigator.onLine === false` is reliable: the device has no connection at all.
 * `true` only means a connection exists, not that the API is reachable (captive
 * portal, a dead Wi-Fi), so a request can still fail while this says online;
 * those failures are handled where they happen (see `networkErrors`).
 *
 * Capacitor's `@capacitor/network` plugin would report the native connectivity
 * state more precisely inside the app, but it is a native plugin and needs a
 * store release (AGENTS.md 6b). The WebView mirrors the system state into
 * `navigator.onLine` and fires `online` / `offline`, which is what this uses.
 */
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** Reads the browser's own flag; an environment without one counts as online. */
export function isOnline() {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

/**
 * Calls `listener(online)` whenever connectivity changes. Returns an
 * unsubscribe function.
 *
 * Also re-reads the flag when the page becomes visible again: a WebView that sat
 * in the background can miss the `online` / `offline` event, and the person
 * would come back to a screen that still believes the old state.
 */
export function subscribeOnline(listener) {
  if (typeof window === 'undefined') return () => {};
  let last = isOnline();
  const sync = () => {
    const now = isOnline();
    if (now === last) return;
    last = now;
    listener(now);
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  document.addEventListener('visibilitychange', sync);
  return () => {
    window.removeEventListener('online', sync);
    window.removeEventListener('offline', sync);
    document.removeEventListener('visibilitychange', sync);
  };
}

/** `true` while online; re-renders on change. */
export function useOnlineStatus() {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

/**
 * Makes `onlineManager` follow `isOnline()`. Once, from each entry point,
 * before the first render. Safe to call again (it replaces the listener).
 */
export function installNetworkStatus() {
  onlineManager.setEventListener((setOnline) => subscribeOnline(setOnline));
  onlineManager.setOnline(isOnline());
}
