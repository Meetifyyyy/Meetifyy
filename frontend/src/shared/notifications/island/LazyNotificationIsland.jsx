import { lazy, Suspense, useEffect, useState } from 'react';
import { islandSnapshot, islandSubscribe } from './islandStore';

const NotificationIsland = lazy(() => import('./NotificationIsland'));

/** How long after mounting the island's code is asked for, and the longest an idle wait may add. */
const WARM_DELAY_MS = 2500;
const WARM_TIMEOUT_MS = 4000;

/**
 * The notification island, loaded after the first screen instead of with it.
 *
 * The island is mounted for the whole signed-in session but draws nothing
 * until a notification arrives. Imported directly, it put its animation
 * library in the entry bundle: 423 kB of a 988 kB chunk in the installed app
 * (measured 2026-11-11), fetched, compiled and evaluated on every cold start
 * before Home could render, for a surface that is empty at launch.
 *
 * Its code is fetched a couple of seconds in, when the page is idle, so it is
 * in place before a notification is likely, and at once if one arrives sooner. The
 * store is framework-free and keeps whatever was posted meanwhile, so nothing
 * is lost while the chunk loads: the island mounts and shows it.
 */
export default function LazyNotificationIsland() {
  const [wanted, setWanted] = useState(() => islandSnapshot().items.length > 0);

  useEffect(() => {
    if (wanted) return undefined;
    const want = () => setWanted(true);
    const unsubscribe = islandSubscribe(want);
    // Not in the launch's first idle gap: that is while the splash is lifting,
    // and compiling the library there would cost the reveal its frames.
    let idleId;
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(want, { timeout: WARM_TIMEOUT_MS });
      } else {
        want();
      }
    }, WARM_DELAY_MS);
    const cancelIdle = () => {
      clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
    };
    return () => {
      unsubscribe();
      cancelIdle();
    };
  }, [wanted]);

  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <NotificationIsland />
    </Suspense>
  );
}
