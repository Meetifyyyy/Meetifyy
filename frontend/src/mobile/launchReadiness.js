/**
 * Holds the native splash until the screen it will reveal has painted.
 *
 * AuthContext calls `window.__meetifyyBoot.ready()` as soon as authentication
 * is DECIDED (see index.mobile.html). That is the right moment to stop waiting
 * on auth, but not yet a screen: a signed-in launch still redirects to /home
 * and loads its route, so the splash could fade onto a page with nothing on
 * it. This wraps `ready()` so it releases the splash once the destination is
 * in the DOM — a `<main>` (every signed-in page and its skeleton has one) or
 * an element marked `data-launch-surface` (the opening screen) — and has had
 * two frames to paint.
 *
 * It never holds the splash for long: after `maxWaitMs` it releases whatever
 * is on screen, exactly as before. Authentication itself is untouched; this
 * only decides which frame the splash fades onto.
 */
export const LAUNCH_SURFACE_SELECTOR = '#root main, #root [data-launch-surface]';

export function installLaunchReadiness({
  boot = typeof window === 'undefined' ? undefined : window.__meetifyyBoot,
  maxWaitMs = 900,
  now = () => performance.now(),
  nextFrame = (cb) => window.requestAnimationFrame(cb),
  hasSurface = () => document.querySelector(LAUNCH_SURFACE_SELECTOR) !== null,
  // A clock that does not depend on frames. See `backstop` below.
  later = (cb, ms) => window.setTimeout(cb, ms),
  // Told as the splash is released, so native can lift it without waiting for
  // its next poll (which queues behind this thread). Optional.
  onRelease = () => {},
} = {}) {
  if (!boot || typeof boot.ready !== 'function') return;
  const release = boot.ready;
  let pending = false;
  let released = false;
  // Marks on the page's own timeline, readable over devtools from a device
  // build: where a launch spends its time between auth and the splash lifting.
  const mark = (name) => { try { performance.mark(name); } catch { /* optional */ } };
  const releaseOnce = (via) => {
    if (released) return;
    released = true;
    mark(`meetifyy:splash-release:${via}`);
    release();
    try { onRelease(); } catch { /* the poll still lifts the splash */ }
  };

  boot.ready = () => {
    if (pending || boot.appReady) return;
    pending = true;
    mark('meetifyy:auth-decided');
    const startedAt = now();
    const settle = () => {
      mark('meetifyy:surface');
      nextFrame(() => nextFrame(() => releaseOnce('frames')));
    };
    const check = () => {
      if (hasSurface() || now() - startedAt >= maxWaitMs) settle();
      else nextFrame(check);
    };
    check();
    /*
     * The wait above is counted in animation frames, and frames are exactly
     * what a page behind a held splash may not get: the platform can throttle
     * rAF for a WebView whose window is not being drawn. If it does, neither
     * the cap nor the two-frame settle ever completes and the NATIVE backstop
     * (seconds later) is what finally lifts the splash. A timer keeps the cap
     * honest; in the normal case the frames win and this does nothing.
     */
    later(() => releaseOnce('timer'), maxWaitMs + 100);
  };
}
