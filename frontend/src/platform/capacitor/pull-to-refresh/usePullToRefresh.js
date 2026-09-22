import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The gesture, the state machine and the locking behind pull-to-refresh.
 *
 * WHY THIS LIVES UNDER platform/capacitor/
 * It is selected by `@shared/components/PullToRefresh`, which picks between
 * this and a passthrough using `IS_MOBILE_BUILD` — the same build-time literal
 * `apiClient` uses to choose its API origin and session source. Vite replaces
 * it with a constant, so the branch the web build does not take is dropped and
 * none of this reaches the website's bundle.
 *
 * That gate is the platform, not the screen size. The implementation this
 * replaces was gated on a `max-width: 768px` media query, which is a VIEWPORT
 * test — and true in a mobile browser as well, so the website got a
 * pull-to-refresh it was never meant to have.
 *
 * WHAT THE SCREEN OWNS AND WHAT THIS OWNS
 * This owns the drag, the thresholds, the state machine and the guarantee that
 * two refreshes never overlap. The screen owns `onRefresh` — whatever reloading
 * its data already means. Nothing about a feed, a conversation list or a
 * profile is known here.
 *
 * THE SCROLL CONTAINER
 * Defaults to the window, because in this app the window IS the scroller:
 * `global.css` deliberately leaves html/body/#root scrollable rather than
 * pinning them, to keep native momentum and rubber-banding. A screen that
 * genuinely scrolls inside its own element passes `getScrollTop`.
 *
 * @param {object}   opts
 * @param {() => Promise<unknown>|unknown} opts.onRefresh  the screen's reload
 * @param {boolean}  [opts.disabled]
 * @param {() => number} [opts.getScrollTop] override for a non-window scroller
 */

/** Finger travel needed before releasing counts as a refresh. */
const TRIGGER_DISTANCE = 72;
/** Visual ceiling, so a long drag cannot run the indicator off the screen. */
const MAX_PULL = 120;
/**
 * How long the refreshing state is held at minimum.
 *
 * A refresh that resolves from cache in 40ms would otherwise show the spinner
 * for two frames — a flicker that reads as "nothing happened" rather than as a
 * refresh. Long enough to register, short enough not to feel like a wait.
 */
const MIN_REFRESH_MS = 450;

/**
 * Rubber band, not a constant ratio.
 *
 * A flat multiplier makes the pull feel linear and, worse, identical whether
 * the user has moved 10px or 200px. Resistance that grows with distance is what
 * makes the sheet feel attached to the finger near the top and increasingly
 * reluctant as it stretches — the behaviour every native list has.
 */
function damp(delta) {
  if (delta <= 0) return 0;
  return MAX_PULL * (1 - Math.exp(-delta / (MAX_PULL * 0.9)));
}

/**
 * True when the touch began inside something that scrolls and is not at its top.
 *
 * This is the nested-scroll rule. A horizontal carousel, a modal's list, a
 * chat pane — anything with its own overflow — must keep its gesture. Walking
 * up from the touch target is the only reliable way to know, because the
 * listener is on the screen-level wrapper and by then the event has already
 * passed through whatever it started in.
 *
 * `data-no-pull-refresh` is the explicit escape hatch for a subtree that scrolls
 * in a way this cannot infer.
 */
function isInsideNestedScroller(target, root) {
  let node = target instanceof Element ? target : null;

  while (node && node !== root) {
    if (node.hasAttribute?.('data-no-pull-refresh')) return true;

    const style = window.getComputedStyle(node);
    const scrolls =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 1;

    // Only blocks while it has somewhere of its own to scroll back to. A nested
    // list already at its top should hand the gesture up to the page, which is
    // what makes a pull feel continuous rather than dead in places.
    if (scrolls && node.scrollTop > 0) return true;

    node = node.parentElement;
  }

  return false;
}

export function usePullToRefresh({ onRefresh, disabled = false, getScrollTop } = {}) {
  const containerRef = useRef(null);

  const [distance, setDistance] = useState(0);
  /** 'idle' | 'pulling' | 'ready' | 'refreshing' */
  const [phase, setPhase] = useState('idle');

  // Refs, not state, for everything the touch handlers read: they are attached
  // once and must not be torn down and rebuilt on every frame of a drag.
  const startYRef = useRef(0);
  const distanceRef = useRef(0);
  const activeRef = useRef(false);
  const phaseRef = useRef('idle');
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled);
  const getScrollTopRef = useRef(getScrollTop);

  onRefreshRef.current = onRefresh;
  disabledRef.current = disabled;
  getScrollTopRef.current = getScrollTop;

  const setPhaseBoth = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const atTop = useCallback(() => {
    const custom = getScrollTopRef.current;
    if (custom) return custom() <= 0;
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  }, []);

  const settle = useCallback(() => {
    activeRef.current = false;
    distanceRef.current = 0;
    setDistance(0);
    setPhaseBoth('idle');
  }, [setPhaseBoth]);

  const runRefresh = useCallback(async () => {
    /*
     * The lock. A second gesture while a refresh is in flight is ignored
     * outright rather than queued — a queued one fires against data that the
     * first refresh is already replacing, and the user sees two reloads for one
     * intent.
     */
    if (phaseRef.current === 'refreshing') return;

    activeRef.current = false;
    setPhaseBoth('refreshing');
    setDistance(TRIGGER_DISTANCE);
    distanceRef.current = TRIGGER_DISTANCE;

    const startedAt = Date.now();
    try {
      await onRefreshRef.current?.();
    } catch {
      /*
       * A failed refresh settles exactly like a successful one.
       *
       * The screen owns its own error reporting — it already has somewhere to
       * put "could not load", and a gesture affordance is the wrong place to
       * raise one. What must not happen is the indicator staying up forever
       * because a request rejected, which is why this catch exists at all.
       */
    } finally {
      const elapsed = Date.now() - startedAt;
      const hold = Math.max(0, MIN_REFRESH_MS - elapsed);
      window.setTimeout(settle, hold);
    }
  }, [setPhaseBoth, settle]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const onTouchStart = (e) => {
      if (disabledRef.current) return;
      if (phaseRef.current === 'refreshing') return;
      if (e.touches.length !== 1) return;
      if (!atTop()) return;
      if (isInsideNestedScroller(e.target, el)) return;

      startYRef.current = e.touches[0].clientY;
      activeRef.current = true;
    };

    const onTouchMove = (e) => {
      if (!activeRef.current) return;

      const delta = e.touches[0].clientY - startYRef.current;

      // Pulling up, or the page moved off the top mid-drag: hand the gesture
      // back to the browser rather than fighting a scroll that is already
      // under way.
      if (delta <= 0 || !atTop()) {
        if (distanceRef.current !== 0) {
          distanceRef.current = 0;
          setDistance(0);
          setPhaseBoth('idle');
        }
        activeRef.current = false;
        return;
      }

      const damped = damp(delta);
      distanceRef.current = damped;
      setDistance(damped);
      setPhaseBoth(damped >= TRIGGER_DISTANCE ? 'ready' : 'pulling');

      /*
       * Only claims the gesture once it is unambiguously a pull.
       *
       * `preventDefault` before that would swallow the first few pixels of
       * every downward touch on the screen, including the start of an ordinary
       * scroll. The listener is registered non-passively purely so this line is
       * allowed to run — React's `onTouchMove` prop is passive and cannot.
       */
      if (delta > 8 && e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!activeRef.current) return;

      if (distanceRef.current >= TRIGGER_DISTANCE) {
        runRefresh();
      } else {
        settle();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [atTop, runRefresh, settle, setPhaseBoth]);

  return {
    containerRef,
    distance,
    phase,
    isRefreshing: phase === 'refreshing',
    /** 0..1 — how close the drag is to arming, for the indicator. */
    progress: Math.min(1, distance / TRIGGER_DISTANCE),
    TRIGGER_DISTANCE,
  };
}

export default usePullToRefresh;
