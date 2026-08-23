import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Hides the mobile chrome — header, bottom nav, Instant Match launcher — while
 * the user scrolls down, and brings it straight back when they scroll up.
 *
 * Deliberately writes a single attribute on <html> rather than holding React
 * state. A scroll handler that calls setState runs a render on every frame of
 * every scroll, through the whole layout tree; here the only work per frame is
 * one attribute write, and the movement is a CSS transform the compositor
 * handles. Components that care read it in CSS and never re-render at all.
 *
 * "Intelligent" is mostly about not flapping. The rules, in order:
 *
 *   - Near the top, the chrome is always visible. Nothing is gained by hiding
 *     it there and it looks broken on a short bounce.
 *   - Sub-pixel and jitter movements are ignored, so a resting thumb or an
 *     iOS rubber-band cannot toggle it.
 *   - Hiding requires sustained downward travel; revealing happens on the
 *     first real upward movement, because wanting the nav back is an explicit
 *     intent and should feel immediate.
 *   - A page that barely scrolls never hides anything — otherwise the nav
 *     disappears on a page with nowhere to go.
 *
 * Mobile only, by media query. On desktop the attribute is never set.
 */

/** Below this, always show: the top of a page is not a scroll gesture. */
export const TOP_ZONE_PX = 72;
/** Ignore movements smaller than this — thumb jitter and elastic overscroll. */
export const JITTER_PX = 6;
/** Sustained downward travel required before hiding. */
export const HIDE_AFTER_PX = 64;
/** Don't engage unless there is meaningfully more content than viewport. */
export const MIN_SCROLLABLE_PX = 240;

/**
 * The decision itself, as a pure function of the previous state and the new
 * scroll position. Separated from the listener so the rules — which are the
 * whole of "intelligently" — can be exercised directly rather than by
 * simulating scroll events.
 *
 * Returns the next state; `hidden` is what the caller writes to the DOM.
 */
export function nextChromeState(prev, { y, scrollable }) {
  const delta = y - prev.lastY;

  // Jitter: a resting thumb, a rubber-band bounce. Nothing changes, and
  // crucially `lastY` does not move either, so slow drift still accumulates.
  if (Math.abs(delta) < JITTER_PX) return prev;

  const next = { ...prev, lastY: y };

  // Nowhere to scroll: never hide. Otherwise the nav vanishes on a page that
  // cannot scroll it back.
  if (scrollable < MIN_SCROLLABLE_PX) return { ...next, downTravel: 0, hidden: false };

  // The top of the page always shows its chrome.
  if (y <= TOP_ZONE_PX) return { ...next, downTravel: 0, hidden: false };

  if (delta > 0) {
    const downTravel = prev.downTravel + delta;
    return { ...next, downTravel, hidden: downTravel >= HIDE_AFTER_PX ? true : prev.hidden };
  }

  // Any genuine upward movement reveals immediately: wanting the nav back is
  // an explicit intent and should not need a threshold.
  return { ...next, downTravel: 0, hidden: false };
}

export function useAutoHideChrome({ enabled = true } = {}) {
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.removeAttribute('data-chrome-hidden');

    if (!enabled || typeof window === 'undefined') {
      clear();
      return undefined;
    }

    const mq = window.matchMedia('(max-width: 768px)');
    let lastY = window.scrollY;
    let downTravel = 0;
    let hidden = false;
    let frame = 0;

    const setHidden = (next) => {
      if (next === hidden) return;
      hidden = next;
      if (next) root.setAttribute('data-chrome-hidden', 'true');
      else clear();
    };

    const measure = () => {
      frame = 0;
      // Desktop keeps its chrome. Checked here rather than by conditionally
      // attaching, so crossing the breakpoint needs no listener juggling.
      if (!mq.matches) { setHidden(false); return; }

      const state = nextChromeState(
        { lastY, downTravel, hidden },
        {
          y: Math.max(0, window.scrollY),
          scrollable: document.documentElement.scrollHeight - window.innerHeight,
        },
      );

      lastY = state.lastY;
      downTravel = state.downTravel;
      setHidden(state.hidden);
    };

    const onScroll = () => {
      // Coalesce to one measurement per frame; scroll fires far more often.
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    const onMediaChange = () => {
      if (!mq.matches) { clear(); hidden = false; }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    // Rotating a phone or resizing a window crosses the breakpoint.
    mq.addEventListener('change', onMediaChange);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      mq.removeEventListener('change', onMediaChange);
      clear();
    };
  }, [enabled]);

  // Every navigation starts with the chrome visible: arriving on a new page
  // with the nav already hidden reads as it having vanished.
  useEffect(() => {
    document.documentElement.removeAttribute('data-chrome-hidden');
  }, [pathname]);
}
