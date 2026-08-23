import { useEffect } from 'react';

/**
 * Detects a newer deployment and reloads the app onto it.
 *
 * Two behaviours this had to fix.
 *
 * **It fired twice.** Nothing coalesced the triggers. Returning to a tab
 * fires `visibilitychange` AND `focus`, so two checks ran milliseconds
 * apart; both fetched, both saw the same new version, and both ran the
 * teardown-and-navigate. Two navigations were queued with different
 * cache-busting stamps, which the user sees as the app reloading twice in a
 * row. There is now one in-flight check at a time and, more importantly, the
 * reload itself can only ever be started once per page load.
 *
 * **It fired late.** The first check waited 3s after mount and then polled
 * every 20s, so a client could sit on a stale build for most of a minute
 * before noticing — and browsers throttle `setInterval` hard in background
 * tabs, which is exactly where a long-lived PWA spends its time. It now
 * checks immediately on mount, polls more often, and treats the moment a
 * user comes back to the app as the important one, since that is when they
 * are about to interact with a stale build.
 *
 * The retry escape hatch is kept deliberately. If a reload somehow lands
 * back on the old bundle — a service worker still controlling the client, a
 * proxy serving stale HTML — a second attempt is allowed. It is capped, so a
 * genuinely broken deploy cannot put a client into a reload loop.
 */

/** How often to poll while the tab is open. */
const POLL_MS = 15_000;
/** Collapse the burst of triggers that fire together on tab re-entry. */
const TRIGGER_DEBOUNCE_MS = 400;
/** Give up after this many reloads for one version, to avoid a loop. */
const MAX_ATTEMPTS_PER_VERSION = 2;

/** Set for the lifetime of this document once a reload has been committed.
 *  Module scope, so it holds no matter how many callers race. */
let reloadCommitted = false;
/** The current in-flight check, shared by every concurrent trigger. */
let inFlightCheck = null;

function attemptsFor(version) {
  try {
    return Number(sessionStorage.getItem(`app_reload_attempt_${version}`) || 0);
  } catch {
    return 0;
  }
}

function recordAttempt(version) {
  try {
    sessionStorage.setItem(`app_reload_attempt_${version}`, String(attemptsFor(version) + 1));
  } catch { /* private mode */ }
}

async function forceHardRefresh(newVersion) {
  // The single most important line here: whichever caller gets here first
  // owns the reload, and every other concurrent caller returns immediately.
  if (reloadCommitted) return;
  reloadCommitted = true;

  if (attemptsFor(newVersion) >= MAX_ATTEMPTS_PER_VERSION) {
    // Already tried and still stale. Reloading again would spin.
    console.warn(`[version] still on an old build after ${MAX_ATTEMPTS_PER_VERSION} reloads; giving up`);
    return;
  }
  recordAttempt(newVersion);

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // A failed wipe is not a reason to stay on the old build.
  }

  try {
    localStorage.setItem('meetifyy_installed_version', String(newVersion));
  } catch { /* private mode */ }

  // Bust any intermediary still holding the old document. The stamp is
  // stripped again on the next boot so it does not accumulate in the URL.
  const url = new URL(window.location.href);
  url.searchParams.set('_v', String(newVersion));
  window.location.replace(url.toString());
}

/** Removes the cache-busting stamp a previous reload left behind. */
function cleanReloadStamp() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('_v')) return;
    url.searchParams.delete('_v');
    window.history.replaceState(
      window.history.state,
      '',
      url.pathname + url.search + url.hash,
    );
  } catch { /* non-critical */ }
}

export function useVersionCheck() {
  useEffect(() => {
    if (import.meta.env.DEV) return undefined;

    cleanReloadStamp();

    const runCheck = async () => {
      if (reloadCommitted) return;

      const res = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
      });
      if (!res.ok) return;

      const data = await res.json();
      const serverVersion = Number(data.version);
      if (!serverVersion || Number.isNaN(serverVersion)) return;

      const clientBuildTime =
        typeof __APP_BUILD_TIME__ !== 'undefined' ? Number(__APP_BUILD_TIME__) : 0;

      let storedVersion = 0;
      try {
        storedVersion = Number(localStorage.getItem('meetifyy_installed_version') || 0);
      } catch { /* private mode */ }

      // The running bundle's own build stamp is the authority. The stored
      // value is a fallback for builds compiled without one.
      const isStale =
        (clientBuildTime > 0 && serverVersion > clientBuildTime) ||
        (clientBuildTime === 0 && storedVersion > 0 && serverVersion > storedVersion);

      if (isStale) {
        await forceHardRefresh(serverVersion);
        return;
      }

      // Up to date: record it, so a bundle without a build stamp still has a
      // baseline to compare the next deploy against.
      if (serverVersion >= clientBuildTime && serverVersion !== storedVersion) {
        try {
          localStorage.setItem('meetifyy_installed_version', String(serverVersion));
        } catch { /* private mode */ }
      }
    };

    /**
     * One check at a time. Concurrent triggers — and on tab re-entry there
     * are always several — share the in-flight promise instead of each
     * starting their own fetch and their own reload.
     */
    const checkVersion = () => {
      if (reloadCommitted) return Promise.resolve();
      if (inFlightCheck) return inFlightCheck;
      inFlightCheck = runCheck()
        .catch(() => { /* offline, or a bad response: try again next tick */ })
        .finally(() => { inFlightCheck = null; });
      return inFlightCheck;
    };

    // Immediately, not after a delay: a client that boots onto a stale build
    // should not spend the first seconds of its session on it.
    checkVersion();

    const interval = setInterval(checkVersion, POLL_MS);

    // `focus`, `visibilitychange` and `pageshow` all fire together when a
    // user returns to the app. Debounced into one check.
    let debounce = 0;
    const triggerCheck = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(checkVersion, TRIGGER_DEBOUNCE_MS);
    };

    const onVisibility = () => { if (document.visibilityState === 'visible') triggerCheck(); };
    const onPageshow = (e) => { if (e.persisted) triggerCheck(); };

    window.addEventListener('focus', triggerCheck);
    window.addEventListener('online', triggerCheck);
    window.addEventListener('pageshow', onPageshow);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      window.clearTimeout(debounce);
      window.removeEventListener('focus', triggerCheck);
      window.removeEventListener('online', triggerCheck);
      window.removeEventListener('pageshow', onPageshow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
