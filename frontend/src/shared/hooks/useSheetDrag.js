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
 * - Only `transform` is written (translate3d, so it is composited), straight
 *   from touchmove. Android already delivers one touchmove per frame, so
 *   painting on the next requestAnimationFrame (as this did) only put the
 *   sheet a frame behind the finger. One style write per event, no reads.
 * - The sheet's height is measured once when the drag starts, never per move.
 * - `will-change` is set when a drag starts and removed after, so the sheet
 *   does not hold a GPU layer while it is just sitting there. Not at
 *   touch-down: every plain tap on a sheet (its close button included) then
 *   created and dropped a layer while the sheet's own exit animation ran,
 *   which flashes on Android WebView.
 * - Closing by drag leaves the sheet where the slide put it, off screen. It
 *   is put back only if it is still on the page two frames after `onClose`
 *   (a caller that keeps it mounted). Snapping it back straight away showed
 *   the open sheet for the frame or two before React removed it: a flicker.
 * - Grabbing a sheet that is still springing back continues from where it
 *   visibly is. It used to restart from its resting place, a jump.
 * - The end of each slide is taken from `transitionend` (a timer only as a
 *   fallback), so nothing is reset while the sheet is still moving.
 * - Release speed is smoothed over recent moves, so a flick is judged by the
 *   gesture, not by the jitter of the last event; the slide-off then runs at
 *   roughly that speed instead of a fixed duration.
 * - Upward movement never carries the sheet past its resting point. That
 *   keeps the dimmed page behind it from peeking through along the bottom.
 * - Touch events, not pointer events: a pointer drag on a touch screen is
 *   cancelled the moment the browser decides the gesture is a scroll, and only
 *   a non-passive `touchmove` can claim it.
 * - It yields to horizontal gestures: a touch whose first movement is more
 *   sideways than downward is left to the row or carousel under it.
 * - It yields to scrolling. A drag starts only from the handle
 *   (`[data-sheet-handle]`) or when the content under the finger is already
 *   scrolled to the top, so reading a long sheet never closes it by accident.
 *
 * This is an extra way out, never the only one: the sheet's buttons, the
 * backdrop, Escape and Back keep working exactly as before.
 *
 * `onDragStart` (optional) runs once, the moment a touch is recognised as a
 * drag of the sheet — e.g. to put the keyboard away as the sheet starts moving.
 */
export function useSheetDrag(onClose, { enabled = true, media = '(max-width: 768px)', onDragStart } = {}) {
  const sheetRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onDragStartRef = useRef(onDragStart);

  useEffect(() => {
    onCloseRef.current = onClose;
    onDragStartRef.current = onDragStart;
  }, [onClose, onDragStart]);

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
    let startX = 0;
    let fingerY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let height = 1;
    let armed = false;
    let dragging = false;
    let closing = false;
    let timer = 0;
    let resetFrame = 0;
    /** Where the sheet was when this drag took it (non-zero mid snap-back). */
    let baseOffset = 0;
    /** The current slide's completion, run once by transitionend or the timer. */
    let pendingDone = null;

    // True when some scroller between the finger and the sheet's container is
    // not at its top, i.e. a downward swipe there means "scroll up".
    const insideScrolledContent = (node) => {
      for (let n = node; n && n !== backdrop; n = n.parentElement) {
        if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight + 1) return true;
      }
      return backdrop ? backdrop.scrollTop > 0 : false;
    };

    // The sheet may be dismissed downward, but must never translate above its
    // resting position: even a small negative offset exposes the page beneath
    // the bottom edge while the user pulls upward or reverses a drag.
    const offsetFor = (dy) => Math.max(0, dy);

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

    /** The sheet's on-screen offset right now (mid-transition included). */
    const currentOffset = () => {
      const t = getComputedStyle(sheet).transform;
      if (!t || t === 'none') return 0;
      const m = t.match(/matrix(3d)?\(([^)]+)\)/);
      if (!m) return 0;
      const v = m[2].split(',').map(Number);
      const y = m[1] ? v[13] : v[5];
      return Number.isFinite(y) ? Math.max(0, y) : 0;
    };

    /** Runs `done` when the slide that was just started has finished. */
    const afterSlide = (ms, done) => {
      window.clearTimeout(timer);
      pendingDone = null;
      if (!(ms > 0)) { done(); return; }
      let ran = false;
      const run = () => {
        if (ran) return;
        ran = true;
        pendingDone = null;
        window.clearTimeout(timer);
        done();
      };
      pendingDone = run;
      // Fallback: a transition that never fires its end (display changed,
      // the sheet unmounted mid-slide) still completes.
      timer = window.setTimeout(run, ms + 60);
    };

    const onTransitionEnd = (e) => {
      if (e.target !== sheet || e.propertyName !== 'transform') return;
      pendingDone?.();
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
      startX = e.touches[0].clientX;
      lastT = e.timeStamp;
      velocity = 0;
    };

    const onMove = (e) => {
      if (!armed) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (!dragging) {
        // Axis lock. A gesture that moves sideways first belongs to whatever
        // scrolls horizontally under the finger (a row of share targets, a
        // carousel) and never moves the sheet, however it wanders after.
        const dx = Math.abs(e.touches[0].clientX - startX);
        if (dx > 6 && dx >= Math.abs(dy)) { armed = false; return; }
        // An upward first move is a scroll, not a dismiss; let it go.
        if (dy < -4) { armed = false; return; }
        if (dy < 6 || dy < dx) return;
        dragging = true;
        // Re-base on the current finger so the sheet does not jump by the
        // slop distance the moment it is grabbed.
        startY = y;
        height = sheet.getBoundingClientRect().height || 1;
        // Mid snap-back: take it from where it visibly is, and drop the
        // snap-back's own completion, which would reset it under the finger.
        baseOffset = pendingDone ? currentOffset() : 0;
        window.clearTimeout(timer);
        pendingDone = null;
        // A running entrance animation would override the inline transform.
        sheet.style.animation = 'none';
        sheet.style.willChange = 'transform';
        setTransition(0);
        paint(baseOffset);
        onDragStartRef.current?.();
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
      paint(offsetFor(baseOffset + fingerY - startY));
    };

    const onEnd = (e) => {
      if (!armed) return;
      armed = false;
      if (!dragging) return;
      dragging = false;

      // A finger that stopped before lifting is not a flick.
      const stale = e && e.timeStamp - lastT > 80;
      const speed = stale ? 0 : velocity;
      const dy = offsetFor(baseOffset + fingerY - startY);
      baseOffset = 0;
      const instant = reduceMotion.matches;

      if (dy > height * DISMISS_FRACTION || speed > FLICK_SPEED) {
        closing = true;
        const remaining = height + 24 - dy;
        // Carry the release speed through, within sane bounds.
        const ms = instant ? 0 : Math.round(Math.min(320, Math.max(160, remaining / Math.max(speed, 1.2))));
        setTransition(ms);
        paint(height + 24);
        afterSlide(ms, () => {
          onCloseRef.current?.();
          // Stays off screen while the caller removes it. Only a sheet still
          // on the page two frames later (kept mounted) is put back, and then
          // nobody is looking at it.
          resetFrame = window.requestAnimationFrame(() => {
            resetFrame = window.requestAnimationFrame(() => {
              resetFrame = 0;
              closing = false;
              if (!sheet.isConnected) return;
              setTransition(0);
              paint(0);
              release();
            });
          });
        });
      } else {
        const ms = instant ? 0 : 280;
        setTransition(ms);
        paint(0);
        afterSlide(ms, release);
      }
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    sheet.addEventListener('transitionend', onTransitionEnd);
    return () => {
      window.clearTimeout(timer);
      if (resetFrame) window.cancelAnimationFrame(resetFrame);
      pendingDone = null;
      sheet.removeEventListener('transitionend', onTransitionEnd);
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, media]);

  return sheetRef;
}

export default useSheetDrag;
