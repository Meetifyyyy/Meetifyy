import { useEffect, useRef } from 'react';
import { createGestureSpring, rubberBand } from '@shared/lib/gestureSpring';

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
 * - Release is a spring seeded with the finger's speed (smoothed over recent
 *   moves, so one jittery event cannot turn a slow drag into a flick): a
 *   flick leaves fast, a slow drag settles gently, and the snap-back ends in
 *   a slight bounce because the drag applied force. Reduced motion: no spring.
 * - Pulled upward past its resting point it stretches (rubber band) instead
 *   of stopping dead. While it is above rest a "skirt" fills the strip it
 *   uncovers: a real element in the sheet's own colour pinned to the bottom of
 *   the screen, so the sheet's bottom stays attached to the screen's (see
 *   makeSkirt). A sheet that does not rest on the bottom edge, or has no opaque
 *   background of its own, keeps the hard stop, so the page behind can never
 *   show through.
 * - Touch events, not pointer events: a pointer drag on a touch screen is
 *   cancelled the moment the browser decides the gesture is a scroll, and only
 *   a non-passive `touchmove` can claim it.
 * - It yields to horizontal gestures: a touch whose first movement is more
 *   sideways than downward is left to the row or carousel under it.
 * - It yields to scrolling. A drag starts only from the handle
 *   (`[data-sheet-handle]`) or when the content under the finger is already
 *   scrolled to the top, so reading a long sheet never closes it by accident.
 *
 * - The dimmed backdrop fades with the drag, from the same value that moves
 *   the sheet, so it is exactly as faded as the sheet is dismissed — mid-drag,
 *   mid-spring, reversing — and is already clear when the sheet leaves the
 *   screen, instead of vanishing in one frame when the sheet unmounts. Its
 *   colour and blur are copied onto a layer of their own behind the sheet for
 *   the drag, and only that layer's opacity changes: compositor-only, no
 *   repaint, and the sheet itself (a child of the backdrop) never fades.
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

    const DISMISS_FRACTION = 0.25;
    const FLICK_SPEED = 0.5; // px per ms, downward
    /** The most an upward pull (or the snap-back's bounce) lifts the sheet. */
    const STRETCH_PX = 28;
    /** The skirt reaches further than the sheet can ever lift. */
    const SKIRT_PX = 64;

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
    let resetFrame = 0;
    /** Where the sheet was when this drag took it (non-zero mid snap-back). */
    let baseOffset = 0;
    /** The skirt's colour for this drag, or null when upward stretch is off. */
    let skirtColor = null;
    let skirtOn = false;
    /** The backdrop's dim, lifted onto its own layer for this drag. */
    let dim = null;
    let backdropSaved = null;

    // True when some scroller between the finger and the sheet's container is
    // not at its top, i.e. a downward swipe there means "scroll up".
    const insideScrolledContent = (node) => {
      for (let n = node; n && n !== backdrop; n = n.parentElement) {
        if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight + 1) return true;
      }
      return backdrop ? backdrop.scrollTop > 0 : false;
    };

    const isOpaque = (c) => !!c && c !== 'transparent' && !/rgba?\([^)]*,\s*0\s*\)$/.test(c)
      && !/\/\s*0\s*\)$/.test(c);

    /** The sheet's own opaque background colour, or null. */
    const sheetColor = () => {
      for (const el of [sheet, sheet.firstElementChild]) {
        if (!el) continue;
        const c = getComputedStyle(el).backgroundColor;
        if (isOpaque(c)) return c;
      }
      return null;
    };

    /**
     * The skirt: a real element in the sheet's colour, pinned to the bottom of
     * the screen under the sheet, as wide as the sheet. While the sheet is
     * lifted it shows exactly as tall as the lift, so the sheet's bottom stays
     * attached to the screen's. A real element, not a shadow: it is painted
     * whatever the sheet's own CSS (overflow, shadows), and the app's system
     * bars, which read the page by hit-testing just above the navigation bar,
     * see the sheet's colour there instead of the page behind it.
     * Moved only by transform; made at drag start, removed when it settles.
     */
    let skirtEl = null;
    const makeSkirt = () => {
      if (skirtEl || !skirtColor || !backdrop) return;
      const r = sheet.getBoundingClientRect();
      skirtEl = document.createElement('div');
      skirtEl.setAttribute('aria-hidden', 'true');
      skirtEl.dataset.sheetSkirt = '';
      skirtEl.style.cssText = `position:fixed;bottom:0;left:${r.left}px;width:${r.width}px;height:${SKIRT_PX}px;`
        + `transform:translate3d(0,${SKIRT_PX}px,0);will-change:transform;`;
      skirtEl.style.background = skirtColor;
      // AFTER the sheet, so it paints over the sheet's own drop shadow: a
      // shadow's blur reaches below the sheet's bottom edge, and drawn over
      // the skirt it showed as a grey band under a lifted sheet. The skirt
      // overlaps the sheet by only 1px, in the sheet's own colour.
      sheet.after(skirtEl);
    };
    const dropSkirt = () => {
      skirtEl?.remove();
      skirtEl = null;
      skirtOn = false;
    };
    const setSkirt = (lift) => {
      if (!skirtEl) return;
      const on = lift > 0.5;
      if (!on && !skirtOn) return;
      skirtOn = on;
      skirtEl.style.transform = `translate3d(0, ${(SKIRT_PX - (on ? lift + 1 : 0)).toFixed(2)}px, 0)`;
    };

    /** Finger offset (down positive) -> sheet offset, stretching above rest. */
    const offsetFor = (dy) => {
      if (dy >= 0) return dy;
      return skirtColor ? -rubberBand(-dy, STRETCH_PX) : 0;
    };

    const paint = (y) => {
      // A bounce can overshoot above rest; never further than the skirt covers.
      const top = skirtColor ? -STRETCH_PX : 0;
      const v = Math.max(top, y);
      setSkirt(-v);
      sheet.style.transform = Math.abs(v) > 0.01 ? `translate3d(0, ${v.toFixed(2)}px, 0)` : '';
    };

    /** Lifts the backdrop's colour and blur onto a layer that can fade alone. */
    const liftDim = () => {
      if (dim || !backdrop || !backdrop.isConnected) return;
      const cs = getComputedStyle(backdrop);
      // The layer sits at z-index -1 inside the backdrop's stacking context,
      // which a fixed backdrop always is; anything else is left alone.
      if (cs.position !== 'fixed') return;
      const color = cs.backgroundColor;
      const filter = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      if (!isOpaque(color) && filter === 'none') return;
      dim = document.createElement('div');
      dim.setAttribute('aria-hidden', 'true');
      dim.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;will-change:opacity;';
      dim.style.background = color;
      if (filter !== 'none') {
        dim.style.backdropFilter = filter;
        dim.style.webkitBackdropFilter = filter;
      }
      backdropSaved = {
        background: backdrop.style.background,
        backdropFilter: backdrop.style.backdropFilter,
        webkitBackdropFilter: backdrop.style.webkitBackdropFilter,
        transition: backdrop.style.transition,
      };
      backdrop.prepend(dim);
      backdrop.style.transition = 'none';
      backdrop.style.background = 'transparent';
      backdrop.style.backdropFilter = 'none';
      backdrop.style.webkitBackdropFilter = 'none';
    };

    /** Puts the backdrop's own dim back (snap-back, or a sheet kept mounted). */
    const dropDim = () => {
      if (!dim) return;
      dim.remove();
      dim = null;
      if (backdropSaved) {
        backdrop.style.background = backdropSaved.background;
        backdrop.style.backdropFilter = backdropSaved.backdropFilter;
        backdrop.style.webkitBackdropFilter = backdropSaved.webkitBackdropFilter;
        backdrop.style.transition = backdropSaved.transition;
        backdropSaved = null;
      }
    };

    const paintWithDim = (y) => {
      paint(y);
      if (dim) {
        const shown = 1 - Math.min(1, Math.max(0, y) / (height || 1));
        dim.style.opacity = shown.toFixed(3);
      }
    };

    const spring = createGestureSpring(paintWithDim, { stiffness: 520, dampingRatio: 0.86 });

    const release = () => {
      dropSkirt();
      dropDim();
      sheet.style.willChange = '';
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
        baseOffset = spring.isMoving() ? spring.value() : 0;
        // Stretching upward needs a sheet that rests on the screen's bottom
        // edge (a phone sheet; not a centred dialog) and a colour to extend.
        {
          const restBottom = sheet.getBoundingClientRect().bottom - baseOffset;
          skirtColor = restBottom >= window.innerHeight - 1 ? sheetColor() : null;
        }
        liftDim();
        makeSkirt();
        // A running entrance animation would override the inline transform.
        sheet.style.animation = 'none';
        sheet.style.transition = 'none';
        sheet.style.willChange = 'transform';
        spring.set(baseOffset);
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
      spring.set(offsetFor(baseOffset + fingerY - startY));
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
        const gone = height + 24;
        const closed = () => {
          onCloseRef.current?.();
          // Stays off screen while the caller removes it. Only a sheet still
          // on the page two frames later (kept mounted) is put back, and then
          // nobody is looking at it.
          resetFrame = window.requestAnimationFrame(() => {
            resetFrame = window.requestAnimationFrame(() => {
              resetFrame = 0;
              closing = false;
              if (!sheet.isConnected) return;
              spring.set(0);
              sheet.style.transition = '';
              release();
            });
          });
        };
        // Leaves at the finger's speed (at least a brisk one), no bounce: it
        // is going off screen, there is nothing to bounce against.
        // Aimed past the edge and finished the moment it is wholly off
        // screen, so it never decelerates into place where nobody can see.
        spring.to(gone + 40, {
          until: (y) => y >= gone,
          done: closed,
          velocity: Math.max(speed, 1.2) * 1000,
          dampingRatio: 1,
          stiffness: 320,
          instant,
        });
      } else {
        // Snap-back is quick and carries the finger's speed; the slight
        // overshoot above rest is covered by the skirt.
        spring.to(0, {
          velocity: speed * 1000,
          instant,
          done: () => {
            sheet.style.transition = '';
            release();
          },
        });
      }
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      spring.stop();
      dropDim();
      dropSkirt();
      if (resetFrame) window.cancelAnimationFrame(resetFrame);
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, media]);

  return sheetRef;
}

export default useSheetDrag;
