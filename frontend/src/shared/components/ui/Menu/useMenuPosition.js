import { useLayoutEffect, useState } from 'react';

/** Gap between the anchor (or press point) and the menu. */
export const MENU_GAP = 6;
/** Closest the menu may come to the edge of the viewport. */
export const MENU_EDGE_MARGIN = 8;

/**
 * Places a menu against a point, clamped and flipped to stay on screen.
 *
 * Lifted unchanged in behaviour from `MessageContextMenu`, which is where this
 * logic already lived and which two other menus were importing it from — a
 * feature component had become a utility module for the rest of the app. The
 * rule is the same: offset from the point, flip to the other side when that
 * would overflow, then clamp so a menu taller than the viewport still has its
 * top edge visible rather than being centred out of reach.
 *
 * @param {{x:number,y:number}} point
 * @param {{width:number,height:number}} size
 * @param {{width:number,height:number}} viewport
 */
export function computeMenuPosition(point, size, viewport) {
  const { width, height } = size;
  const gap = MENU_GAP;
  const edge = MENU_EDGE_MARGIN;

  let x = point.x + gap;
  if (x + width > viewport.width - edge) x = point.x - gap - width;
  x = Math.max(edge, Math.min(x, viewport.width - width - edge));

  let y = point.y + gap;
  if (y + height > viewport.height - edge) y = point.y - gap - height;
  y = Math.max(edge, Math.min(y, viewport.height - height - edge));

  return { x, y };
}

/**
 * Turns an anchor ELEMENT into the point a menu should be placed against.
 *
 * `align` decides which corner of the anchor the menu hangs from. An anchored
 * menu is normally wanted flush with one edge of its trigger rather than
 * offset from a point, which is why this returns the edge rather than the
 * centre — and why `computeMenuPosition` is then free to flip it if the edge
 * it chose does not fit.
 */
function pointFromAnchor(el, align) {
  const r = el.getBoundingClientRect();
  return {
    // `- MENU_GAP` cancels the gap `computeMenuPosition` adds, so an anchored
    // menu lines up with its trigger's edge instead of sitting a few pixels
    // inside it.
    x: align === 'start' ? r.left - MENU_GAP : r.right - MENU_GAP,
    y: r.bottom,
    // The flip above is computed from the point alone and would put a flipped
    // menu on top of the trigger. Passing the trigger's own top edge lets the
    // caller flip to ABOVE the trigger instead of over it.
    flipY: r.top,
  };
}

/**
 * Resolves a menu's on-screen position, for either an anchor element or a
 * raw point (a long-press or right-click).
 *
 * MEASURED, NOT ESTIMATED
 * The menu is rendered off-screen for one frame and measured, because its
 * height depends on how many items the caller passed and there is no way to
 * know that in advance. `ready` is false for that frame so the caller can keep
 * it invisible — without it the menu is visibly painted in the wrong place and
 * then moves, which is the flicker this exists to avoid.
 *
 * `visualViewport.height` rather than `innerHeight`: with a keyboard open on
 * Android the two differ by the height of the keyboard, and a menu clamped to
 * `innerHeight` is clamped to a region partly behind it.
 *
 * @param {object}  opts
 * @param {boolean} opts.open
 * @param {React.RefObject<HTMLElement>} opts.menuRef
 * @param {React.RefObject<HTMLElement>|null} [opts.anchorRef]
 * @param {{x:number,y:number}|null} [opts.point]
 * @param {'start'|'end'} [opts.align]
 * @param {unknown} [opts.deps] changes that can alter the menu's size
 */
export function useMenuPosition({ open, menuRef, anchorRef, point, align = 'end', deps }) {
  const [coords, setCoords] = useState({ x: -9999, y: -9999, ready: false });

  useLayoutEffect(() => {
    if (!open) {
      setCoords({ x: -9999, y: -9999, ready: false });
      return undefined;
    }

    const place = () => {
      const el = menuRef.current;
      if (!el) return;

      const size = {
        width: el.offsetWidth || 180,
        height: el.offsetHeight || 200,
      };
      const viewport = {
        width: window.innerWidth,
        height: window.visualViewport?.height || window.innerHeight,
      };

      let target = point;
      const anchorEl = anchorRef?.current;
      if (!target && anchorEl) target = pointFromAnchor(anchorEl, align);
      if (!target) return;

      const next = computeMenuPosition(target, size, viewport);

      /*
       * An anchored menu that had to flip goes ABOVE its trigger, not over it.
       * `computeMenuPosition` only knows about the point it was given, so it
       * would place the flipped menu ending at that point — which for an
       * anchor is the trigger's bottom edge, covering the thing that opened it.
       */
      if (target.flipY != null && next.y < target.y) {
        next.y = Math.max(MENU_EDGE_MARGIN, target.flipY - size.height - MENU_GAP);
      }

      setCoords({ ...next, ready: true });
    };

    place();

    /*
     * Re-place on scroll and resize.
     *
     * An anchored menu is positioned in viewport coordinates, so any scroll of
     * any ancestor moves its trigger out from under it. `capture: true` is what
     * catches scrolls of nested containers — a scroll event does not bubble, so
     * a listener on window sees only the document's own.
     */
    const onMove = () => place();
    window.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove, { passive: true });
    window.visualViewport?.addEventListener('resize', onMove);

    return () => {
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      window.visualViewport?.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's opaque "my size may have changed" signal
  }, [open, anchorRef, point?.x, point?.y, align, deps, menuRef]);

  return coords;
}

export default useMenuPosition;
