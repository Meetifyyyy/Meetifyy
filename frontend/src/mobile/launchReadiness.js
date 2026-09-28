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
} = {}) {
  if (!boot || typeof boot.ready !== 'function') return;
  const release = boot.ready;
  let pending = false;

  boot.ready = () => {
    if (pending || boot.appReady) return;
    pending = true;
    const startedAt = now();
    const settle = () => nextFrame(() => nextFrame(() => release()));
    const check = () => {
      if (hasSurface() || now() - startedAt >= maxWaitMs) settle();
      else nextFrame(check);
    };
    check();
  };
}
