import { useEffect, useRef } from 'react';

/**
 * Drag-down-to-dismiss for a bottom sheet, like a native app's.
 *
 * Returns a ref for the sheet element. While `media` matches (phones), a
 * vertical drag that starts on the sheet follows the finger, and releasing it
 * past a quarter of its height, or with a downward flick, slides it off and
 * calls `onClose`. Anything shorter springs back.
 *
 * Built to stay smooth on low-end Android:
 * - Only `transform` is written (translate3d, so it is composited), and at
 *   most once per frame: touchmove only records
 *   the finger, a requestAnimationFrame callback paints it.
 * - The sheet's height is measured once when the drag starts, never per move.
 * - `will-change` is set for the drag and removed after, so the sheet does not
 *   hold a GPU layer while it is just sitting there.
 * - Release speed is smoothed over recent moves, so a flick is judged by the
 *   gesture, not by the jitter of the last event; the slide-off then runs at
 *   roughly that speed instead of a fixed duration.
 * - Pulling up past the resting point gives a little rubber-band resistance
 *   instead of a hard stop.
 * - Touch events, not pointer events: a pointer drag on a touch screen is
 *   cancelled the moment the browser decides the gesture is a scroll, and only
 *   a non-passive `touchmove` can claim it.
 * - It yields to scrolling. A drag starts only from the handle
 *   (`[data-sheet-handle]`) or when the content under the finger is already
 *   scrolled to the top, so reading a long sheet never closes it by accident.
 *
 * This is an extra way out, never the only one: the sheet's buttons, the
 * backdrop, Escape and Back keep working exactly as before.
 */
export function useSheetDrag(onClose, { enabled = true, media = '(max-width: 768px)' } = {}) {
  const sheetRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !enabled || typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mq = window.matchMedia(media);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const backdrop = sheet.parentElement;

    const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const DISMISS_FRACTION = 0.25;
    const FLICK_SPEED = 0.5; // px per ms, downward

    let startY = 0;
    let fingerY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let height = 1;
    let armed = false;
    let dragging = false;
    let closing = false;
    let frame = 0;
    let timer = 0;

    // True when some scroller between the finger and the sheet's container is
    // not at its top, i.e. a downward swipe there means "scroll up".
    const insideScrolledContent = (node) => {
      for (let n = node; n && n !== backdrop; n = n.parentElement) {
        if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight + 1) return true;
      }
      return backdrop ? backdrop.scrollTop > 0 : false;
    };

    // Downward: 1:1 with the finger. Upward: resisted, and capped.
    const offsetFor = (dy) => (dy >= 0 ? dy : -Math.min(24, Math.sqrt(-dy) * 2));

    const paint = (y) => {
      // Position only: the sheet and its backdrop stay fully visible.
      sheet.style.transform = y ? `translate3d(0, ${y}px, 0)` : '';
    };

    const setTransition = (ms) => {
      sheet.style.transition = ms > 0 ? `transform ${ms}ms ${EASE_OUT}` : 'none';
    };

    const release = () => {
      sheet.style.transition = '';
      sheet.style.willChange = '';
    };

    const onFrame = () => {
      frame = 0;
      paint(offsetFor(fingerY - startY));
    };

    const onStart = (e) => {
      if (!mq.matches || closing || e.touches.length !== 1) return;
      const target = e.target;
      if (!target.closest?.('[data-sheet-handle]')) {
        if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (insideScrolledContent(target)) return;
      }
      armed = true;
      dragging = false;
      startY = fingerY = lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
      velocity = 0;
    };

    const onMove = (e) => {
      if (!armed) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (!dragging) {
        // An upward first move is a scroll, not a dismiss; let it go.
        if (dy < -4) { armed = false; return; }
        if (dy < 6) return;
        dragging = true;
        // Re-base on the current finger so the sheet does not jump by the
        // slop distance the moment it is grabbed.
        startY = y;
        height = sheet.getBoundingClientRect().height || 1;
        // A running entrance animation would override the inline transform.
        sheet.style.animation = 'none';
        sheet.style.willChange = 'transform';
        setTransition(0);
      }
      e.preventDefault();

      const dt = e.timeStamp - lastT;
      if (dt > 0) {
        // Exponential smoothing: recent motion dominates, one noisy event
        // cannot turn a slow drag into a flick.
        velocity = velocity * 0.6 + ((y - lastY) / dt) * 0.4;
      }
      lastY = y;
      lastT = e.timeStamp;
      fingerY = y;
      if (!frame) frame = window.requestAnimationFrame(onFrame);
    };

    const onEnd = (e) => {
      if (!armed) return;
      armed = false;
      if (!dragging) return;
      dragging = false;
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }

      // A finger that stopped before lifting is not a flick.
      const stale = e && e.timeStamp - lastT > 80;
      const speed = stale ? 0 : velocity;
      const dy = Math.max(0, fingerY - startY);
      const instant = reduceMotion.matches;

      if (dy > height * DISMISS_FRACTION || speed > FLICK_SPEED) {
        closing = true;
        const remaining = height + 24 - dy;
        // Carry the release speed through, within sane bounds.
        const ms = instant ? 0 : Math.round(Math.min(320, Math.max(160, remaining / Math.max(speed, 1.2))));
        setTransition(ms);
        paint(height + 24);
        timer = window.setTimeout(() => {
          onCloseRef.current?.();
          // A caller that keeps the sheet mounted gets it back in place.
          closing = false;
          paint(0);
          release();
        }, ms);
      } else {
        const ms = instant ? 0 : 280;
        setTransition(ms);
        paint(0);
        timer = window.setTimeout(release, ms);
      }
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, media]);

  return sheetRef;
}

export default useSheetDrag;
