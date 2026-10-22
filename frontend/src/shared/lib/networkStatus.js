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
 * Inside the installed app the answer comes from the system itself
 * (`@capacitor/network`, via the `NetworkStatus` platform service) and wins over
 * `navigator.onLine`, which the WebView only mirrors and can miss across a
 * background/resume. A native "offline" means no connection of any kind: the
 * system's own `connected` flag is also false while a network is merely not
 * validated yet (a few seconds after every switch, for good on a network that
 * blocks its probe), so the native implementation reports that as online (see
 * `platform/capacitor/network.js`). Until the native side has answered (a few ms after launch,
 * or never, in a shell built before the plugin existed) the browser flag is
 * used, so there is always an answer. The website never loads the native
 * implementation (AGENTS.md 6d).
 */
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { IS_MOBILE_BUILD } from '@config';
import { readNavigatorOnline } from '@platform/web/network';

/** The native answer; `null` until it has spoken. */
let nativeOnline = null;
/** Called when the native answer changes, so subscribers re-read. */
const nativeListeners = new Set();
let nativeDetach = null;

function setNativeOnline(online) {
  if (typeof online !== 'boolean' || online === nativeOnline) return;
  nativeOnline = online;
  nativeListeners.forEach((fn) => fn());
}

/**
 * Makes `service` (a `NetworkStatus`, platform/contracts.ts) the primary source.
 * Replaces any earlier one. Exported for the app entry and for tests; the
 * mobile build installs it by itself in `installNetworkStatus`.
 */
export function setNetworkStatusSource(service) {
  nativeDetach?.();
  nativeDetach = null;
  nativeOnline = null;
  if (!service) return;
  let current = true;
  nativeDetach = service.onChange((online) => current && setNativeOnline(online));
  Promise.resolve(service.isOnline())
    .then((online) => {
      // An event that arrived first is newer than this read.
      if (current && nativeOnline === null) setNativeOnline(online);
    })
    .catch(() => {});
  const detach = nativeDetach;
  nativeDetach = () => {
    current = false;
    detach?.();
  };
}

/** The native state when known, else the browser's own flag (no flag counts as online). */
export function isOnline() {
  return nativeOnline !== null ? nativeOnline : readNavigatorOnline();
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
  nativeListeners.add(sync);
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  document.addEventListener('visibilitychange', sync);
  return () => {
    nativeListeners.delete(sync);
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
  if (IS_MOBILE_BUILD) {
    // Lazy: the implementation registers a native plugin at import, and a
    // side-effect import survives tree-shaking in the website bundle too.
    import('@platform/capacitor/network')
      .then((m) => setNetworkStatusSource(m.createCapacitorNetwork()))
      .catch(() => {});
  }
  onlineManager.setEventListener((setOnline) => subscribeOnline(setOnline));
  onlineManager.setOnline(isOnline());
}
