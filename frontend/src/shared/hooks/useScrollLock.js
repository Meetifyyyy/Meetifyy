import { useLayoutEffect } from 'react';
import { createScrollLockCounter } from './scrollLockCounter';

const SCROLLABLE = /(auto|scroll|overlay)/;

/**
 * Freezes background scrolling while an overlay is open.
 *
 * `overflow: hidden` on <body> alone is not enough here: this app scrolls
 * inside nested containers (page bodies, lists, panels), and a wheel event over
 * a fixed overlay still scrolls whichever of those sits underneath. So the app
 * tree is walked and every element that is actually scrollable right now is
 * frozen, each element's own inline value restored on release.
 *
 * Overlays are portalled to <body>, i.e. outside `#root`, so scoping the walk to
 * `#root` cannot freeze a modal's own scrollable regions (the time-slot list,
 * the image grid) - they keep working normally.
 *
 * An overlay that is NOT portalled - the mobile nav drawer lives inside the
 * header - would otherwise have its own scroll frozen along with the page
 * behind it. Marking its root with `data-scroll-lock-ignore` exempts that
 * subtree, so the drawer scrolls while everything under it stays put.
 *
 * ─── Why the state below is module-level and counted ───────────────────────
 *
 * It used to be per-hook-instance: each caller captured the styles it found and
 * restored them on unmount. With one overlay open that is correct. With two it
 * is not, and the app opens two routinely (a share sheet over a details panel,
 * a confirm dialog over a modal, the media viewer over a chat).
 *
 * The second overlay captured the FIRST one's `hidden` as though it were the
 * original value, and whichever unmounted first wrote its captured values back.
 * Closing them in the order they opened therefore restored the real originals
 * while the second overlay was still on screen, and the page behind it started
 * scrolling again.
 *
 * A single counted lock removes the ordering problem entirely: the first
 * overlay to open takes the snapshot, the last to close restores it, and
 * nothing in between can unlock the page.
 */

/** Inline values captured when the lock was first engaged. */
let restore = [];

/** The non-passive touch handler installed for the duration of the lock. */
let touchMoveHandler = null;

/**
 * Blocks background touch scrolling on mobile.
 *
 * `overflow: hidden` is largely advisory on iOS Safari: the page still
 * rubber-bands, and momentum started before the overlay opened keeps running
 * underneath it. Cancelling the gesture is the only thing that reliably stops
 * it, so this listener is non-passive and calls preventDefault.
 *
 * Two exemptions, both load-bearing:
 *
 *   - Anything outside `#root` is overlay content (overlays are portalled to
 *     <body>), and anything inside `[data-scroll-lock-ignore]` is an overlay
 *     that could not be portalled. Both must keep scrolling, or the modal's own
 *     body becomes unscrollable on touch devices - which is a worse bug than
 *     the one being fixed.
 *
 *   - Multi-touch is left alone so pinch-zoom still works. The viewport meta
 *     deliberately allows zoom (WCAG 2.1 AA, 1.4.4), and swallowing two-finger
 *     gestures here would quietly take it back for as long as any modal is open.
 */
function handleTouchMove(event) {
  if (event.touches && event.touches.length > 1) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  if (target.closest('[data-scroll-lock-ignore]')) return;

  const root = document.getElementById('root');
  if (root && !root.contains(target)) return;

  // `cancelable` is false once the browser has committed to scrolling; calling
  // preventDefault then only logs an intervention warning.
  if (event.cancelable) event.preventDefault();
}

function engage() {
  const freeze = (el) => {
    if (!el) return;
    restore.push([el, el.style.overflow]);
    el.style.overflow = 'hidden';
  };

  freeze(document.documentElement);
  freeze(document.body);

  const root = document.getElementById('root');
  if (root) {
    root.querySelectorAll('*').forEach((el) => {
      if (el.closest('[data-scroll-lock-ignore]')) return;
      const cs = getComputedStyle(el);
      const y = SCROLLABLE.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
      const x = SCROLLABLE.test(cs.overflowX) && el.scrollWidth > el.clientWidth;
      if (y || x) freeze(el);
    });
  }

  touchMoveHandler = handleTouchMove;
  document.addEventListener('touchmove', touchMoveHandler, { passive: false });
}

function release() {
  restore.forEach(([el, prev]) => {
    el.style.overflow = prev;
  });
  restore = [];

  if (touchMoveHandler) {
    document.removeEventListener('touchmove', touchMoveHandler, { passive: false });
    touchMoveHandler = null;
  }
}

/**
 * Locks background scrolling for as long as `isActive` is true.
 *
 * Safe to call from any number of overlays at once, in any nesting, and to
 * close them in any order.
 */
/**
 * One counter for the whole application. Every overlay shares it, which is what
 * makes nesting and close-order irrelevant.
 */
const lock = createScrollLockCounter({ engage, release });

export function useScrollLock(isActive = true) {
  useLayoutEffect(() => {
    if (!isActive || typeof document === 'undefined') return undefined;
    lock.acquire();
    return () => lock.release();
  }, [isActive]);
}

export default useScrollLock;
