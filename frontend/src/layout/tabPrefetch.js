/**
 * Having a tab's code ready by the time it is tapped.
 *
 * Every main tab is a lazily loaded route, and the navigation bars warmed one on
 * `mouseenter` - an event a touch screen never produces. On a phone the first
 * visit to each tab therefore started its download at the tap, and the screen sat
 * on a skeleton for the length of that request. Two fixes, both about WHEN the
 * code is fetched rather than how the transition looks:
 *
 *   - on press (`pointerdown`, which lands ~100 ms before the click completes on
 *     touch, and on hover/focus for mouse and keyboard);
 *   - once the browser is idle after start-up, for the tabs not yet visited, so
 *     most taps find the code already there. Skipped on Data Saver and slow links.
 *
 * Importing a module twice is free - the loader caches - so nothing here
 * de-duplicates, and a failed (offline) prefetch is silent: the real navigation
 * will retry and report properly.
 */

/** @param {Record<string, () => Promise<unknown>>} loaders */
export function createTabPrefetcher(loaders) {
  const warm = (key) => {
    const load = loaders[key];
    if (typeof load !== 'function') return;
    try {
      Promise.resolve(load()).catch(() => {});
    } catch {
      /* a synchronous failure is the same as a failed download: ignore */
    }
  };

  /** Handlers to spread on a navigation control. */
  const handlersFor = (key) => ({
    onPointerDown: () => warm(key),
    onMouseEnter: () => warm(key),
    onFocus: () => warm(key),
  });

  const connectionAllowsPrefetch = () => {
    const connection = typeof navigator !== 'undefined' ? navigator.connection : undefined;
    if (!connection) return true;
    if (connection.saveData) return false;
    return !/(^|-)2g$/.test(connection.effectiveType || '');
  };

  /** Warms every tab when the browser has nothing else to do. Returns a canceller. */
  const warmAllWhenIdle = () => {
    if (!connectionAllowsPrefetch()) return () => {};
    const run = () => Object.keys(loaders).forEach(warm);
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run);
      return () => window.cancelIdleCallback?.(handle);
    }
    // No idle callback (older WebViews): after the current task, not during it.
    const handle = setTimeout(run, 0);
    return () => clearTimeout(handle);
  };

  return { warm, handlersFor, warmAllWhenIdle };
}

export const tabPrefetch = createTabPrefetcher({
  home: () => import('@features/feed/pages/FeedRoute'),
  campus: () => import('@features/campus/pages/CampusPage'),
  messages: () => import('@features/messages/pages/MessagesRoute'),
  crew: () => import('@features/crew/pages/FindYourCrewPage'),
  profile: () => import('@features/profile/pages/ProfilePage'),
});
