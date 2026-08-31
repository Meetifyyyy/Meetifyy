import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '@config';

/**
 * Detects that a newer deployment exists. It does NOT reload the page.
 *
 * ## Why this no longer force-refreshes
 *
 * This hook used to poll every 15s and, on spotting a new build, unregister the
 * service worker, delete every cache and `location.replace()` onto a
 * cache-busted URL. That interrupted whoever was using the site the moment a
 * deploy landed — losing scroll position, half-written messages and open
 * dialogs — and it fired on *every* client at once, so a deploy reloaded the
 * whole active user base.
 *
 * It existed for a real reason: browsers (and the service worker's precache)
 * were serving a stale `index.html`, so users genuinely did get stuck on old
 * builds. The force-refresh treated the symptom.
 *
 * The cause is now fixed at the caching layer instead:
 *
 *  - `index.html` and `version.json` are served `no-store` (vercel.json), so a
 *    navigation can never be answered from the HTTP cache;
 *  - the service worker serves navigations **network-first** rather than out of
 *    its precache (`src/sw.js`), so a reload fetches the newest document;
 *  - JS/CSS are content-hashed and immutable, so the new document's asset URLs
 *    are new URLs — there is no stale-bundle question to resolve;
 *  - a newly installed worker waits and is promoted at the next boot
 *    (`main.jsx`), never mid-session.
 *
 * Together those mean **any load or reload already lands on the newest build**.
 * Nothing has to be forcibly refreshed, so this hook only reports.
 *
 * The remaining safety net is unchanged and deliberate: if a stale document
 * does request a chunk that no longer exists, the chunk-load error handlers in
 * `App.jsx` and `ErrorBoundary.jsx` reload once. That is targeted recovery from
 * an actual failure, not a scheduled interruption.
 *
 * @returns {{ updateAvailable: boolean, applyUpdate: () => void }}
 *   `updateAvailable` turns true when the server is ahead of this bundle — use
 *   it to offer a refresh, never to trigger one. `applyUpdate` reloads on an
 *   explicit user action.
 */

/** Poll interval while the tab is open. Slow: nothing depends on reacting fast. */
const POLL_MS = 5 * 60 * 1000;
/** Collapse the burst of triggers that fire together on tab re-entry. */
const TRIGGER_DEBOUNCE_MS = 400;

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const inFlight = useRef(null);
  const settled = useRef(false);

  const applyUpdate = useCallback(() => {
    // A plain reload is enough: `no-store` on the document plus network-first
    // navigations mean the newest build is what comes back. No cache wiping and
    // no `?_v=` stamp — those were only needed to defeat the stale caching that
    // no longer happens.
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!config.features.enableVersionCheck) return undefined;

    /** Strip the cache-busting stamp older builds may have left in the URL. */
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('_v')) {
        url.searchParams.delete('_v');
        window.history.replaceState(
          window.history.state,
          '',
          url.pathname + url.search + url.hash,
        );
      }
    } catch { /* non-critical */ }

    const runCheck = async () => {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;

      const data = await res.json();
      const serverVersion = Number(data.version);
      if (!serverVersion || Number.isNaN(serverVersion)) return;

      const clientBuildTime =
        typeof __APP_BUILD_TIME__ !== 'undefined' ? Number(__APP_BUILD_TIME__) : 0;
      if (!clientBuildTime) return;

      if (serverVersion > clientBuildTime) {
        settled.current = true;
        setUpdateAvailable(true);
      }
    };

    // One check at a time; returning to a tab fires several triggers at once.
    const checkVersion = () => {
      if (settled.current) return Promise.resolve();
      if (inFlight.current) return inFlight.current;
      inFlight.current = runCheck()
        .catch(() => { /* offline or a bad response — try again next tick */ })
        .finally(() => { inFlight.current = null; });
      return inFlight.current;
    };

    checkVersion();
    const interval = setInterval(checkVersion, POLL_MS);

    let debounce = 0;
    const triggerCheck = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(checkVersion, TRIGGER_DEBOUNCE_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerCheck();
    };
    const onSwUpdated = () => setUpdateAvailable(true);

    window.addEventListener('focus', triggerCheck);
    window.addEventListener('online', triggerCheck);
    window.addEventListener('sw:updated', onSwUpdated);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      window.clearTimeout(debounce);
      window.removeEventListener('focus', triggerCheck);
      window.removeEventListener('online', triggerCheck);
      window.removeEventListener('sw:updated', onSwUpdated);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { updateAvailable, applyUpdate };
}
