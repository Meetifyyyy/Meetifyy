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
 *
 * FULLY DRAWN
 * Releasing the splash is Android's time to initial display. The screen it
 * reveals can still be a skeleton (Home with no saved feed, waiting on the
 * network), so after the release this keeps watching for the first screen's
 * real content — the feed having decided what to show (`data-launch-content`
 * on Feed) or the signed-out opening screen — and reports it once through
 * `onFullyDrawn` (native reportFullyDrawn: time to full display). A launch that
 * lands somewhere without such a marker (a link into a chat) reports nothing
 * rather than a guess, and the watch stops after `fullyDrawnMaxMs`.
 */
export const LAUNCH_SURFACE_SELECTOR = '#root main, #root [data-launch-surface]';
export const LAUNCH_CONTENT_SELECTOR = '#root [data-launch-content], #root [data-launch-surface]';

/** Calls `onFound` once `selector` matches under #root, or never; returns a stop function. */
function watchForContent(onFound, selector = LAUNCH_CONTENT_SELECTOR) {
  if (typeof document === 'undefined') return () => {};
  if (document.querySelector(selector)) {
    onFound();
    return () => {};
  }
  const root = document.getElementById('root');
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(() => {
    if (!document.querySelector(selector)) return;
    observer.disconnect();
    onFound();
  });
  // Attributes too: the feed's marker is added to an element already in the DOM.
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-launch-content'] });
  return () => observer.disconnect();
}

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
  // Told once the first screen shows its content (see FULLY DRAWN). Optional.
  onFullyDrawn = () => {},
  watchContent = watchForContent,
  fullyDrawnMaxMs = 15_000,
} = {}) {
  if (!boot || typeof boot.ready !== 'function') return;
  const release = boot.ready;
  let pending = false;
  let released = false;
  // Marks on the page's own timeline, readable over devtools from a device
  // build: where a launch spends its time between auth and the splash lifting.
  const mark = (name) => { try { performance.mark(name); } catch { /* optional */ } };
  const watchFullyDrawn = () => {
    let done = false;
    let stop = () => {};
    const found = () => {
      if (done) return;
      done = true;
      stop();
      mark('meetifyy:fully-drawn');
      try { onFullyDrawn(); } catch { /* reporting only */ }
    };
    stop = watchContent(found);
    if (!done) later(() => { done = true; stop(); }, fullyDrawnMaxMs);
  };
  const releaseOnce = (via) => {
    if (released) return;
    released = true;
    mark(`meetifyy:splash-release:${via}`);
    release();
    try { onRelease(); } catch { /* the poll still lifts the splash */ }
    watchFullyDrawn();
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
