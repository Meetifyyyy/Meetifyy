import { useCallback, useLayoutEffect, useRef } from 'react';
import usePullToRefresh, { TRIGGER_DISTANCE } from './usePullToRefresh';
import styles from './PullToRefresh.module.css';

/**
 * The reusable pull-to-refresh wrapper for the installed app.
 *
 * Wrap a screen's PRIMARY scroll container with it and give it that screen's
 * existing reload function. It contributes the gesture, the indicator and the
 * state machine; it knows nothing about what is being refreshed.
 *
 *   <PullToRefresh onRefresh={refetch}>
 *     …the screen…
 *   </PullToRefresh>
 *
 * Only the screen-level scroller gets one. A carousel inside a feed, a list
 * inside a modal, a chat pane — those keep their own gestures, and
 * `usePullToRefresh` walks up from the touch target to make sure it never
 * steals one. A subtree that scrolls in a way it cannot infer can opt out with
 * `data-no-pull-refresh`.
 *
 * Not exported to the web bundle: this file lives under `src/mobile/`, which
 * only `src/mobile/main.jsx` imports.
 */
/** Matches the content's spring-back transition, plus a frame of slack. */
const SPRING_MS = 360;
/** The spring every part of the pull settles with. */
const SPRING = '0.32s cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * @param {object} props
 * @param {'canvas'|'sheet'} [props.surface] what the pull reveals above the
 *   screen. `canvas` (default) shows the app background, right for screens
 *   of cards on it. `sheet` paints the gap in the page surface colour, for
 *   screens that are one opaque surface (Messages, Profile) - otherwise the
 *   pull opens a band of blue canvas above a white page. Only for
 *   screens that are opaque ON PHONES (Feed and Notifications are not: both
 *   sit on the canvas below 768px).
 */
export default function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  getScrollTop,
  surface = 'canvas',
  pullTargetRef,
}) {
  const gapRef = useRef(null);
  const indicatorRef = useRef(null);
  const dialRef = useRef(null);
  const arcRef = useRef(null);
  const contentRef = useRef(null);
  const settleTimerRef = useRef(0);
  const refreshingRef = useRef(false);
  const pullTargetRefRef = useRef(pullTargetRef);
  pullTargetRefRef.current = pullTargetRef;

  /*
   * Paints the gesture, straight onto the DOM. Called by the hook once per
   * frame while dragging and once on each release, refresh and settle, so a
   * pull never re-renders React (see usePullToRefresh).
   *
   * One distance drives everything: the content, the gap surface above it,
   * the indicator, the dial, and — as CSS variables — a fixed cover header
   * (Profile). While dragging nothing transitions (the finger is the
   * animation); otherwise every part springs with the same curve, so they move
   * as one object.
   */
  const paint = useCallback((distance, dragging) => {
    const d = Math.max(0, distance);
    const spring = dragging ? 'none' : `transform ${SPRING}`;
    const timing = dragging ? '0s' : SPRING;
    window.clearTimeout(settleTimerRef.current);

    /*
     * The content carries a transform only while displaced or springing back.
     *
     * It used to carry `translate3d(0, 0, 0)` permanently. Any transform makes
     * the element the containing block for its `position: fixed` descendants,
     * so every overlay rendered inside a screen - the New Message sheet, menus,
     * FABs - was positioned against the page instead of the viewport and moved
     * whenever the page did. It is dropped once the spring has settled.
     */
    const content = contentRef.current;
    if (content) {
      content.style.transition = spring;
      content.style.transform = `translate3d(0, ${d}px, 0)`;
      content.style.willChange = d > 0 ? 'transform' : 'auto';
    }
    const gap = gapRef.current;
    if (gap) {
      gap.style.transition = spring;
      gap.style.transform = `translate3d(0, ${d}px, 0)`;
      gap.style.visibility = 'visible';
    }
    const indicator = indicatorRef.current;
    if (indicator) {
      indicator.style.transform = `translate3d(-50%, ${d}px, 0) scale(${0.6 + 0.4 * Math.min(1, d / 40)})`;
      indicator.style.opacity = String(Math.min(1, d / 26));
      /*
       * The SAME transition the content uses, and for the same reason: on
       * release the distance settles to the resting refresh offset, and an
       * indicator without it jumped there in one frame while the content
       * glided. Both follow one distance, so both get one curve.
       */
      indicator.style.transition = dragging ? 'none' : `transform ${SPRING}, opacity 0.2s linear`;
    }
    // Tracks the finger 1:1 up to the threshold: the arc closing into a full
    // ring IS the progress readout. While refreshing, CSS animates it instead.
    const progress = Math.min(1, d / TRIGGER_DISTANCE);
    if (dialRef.current) {
      dialRef.current.style.transform = refreshingRef.current ? '' : `rotate(${progress * 270}deg)`;
    }
    if (arcRef.current) {
      arcRef.current.style.strokeDashoffset = refreshingRef.current ? '' : String(94.2 - 94.2 * progress);
    }

    // A fixed header over the pull (Profile's cover) gets the pull as CSS
    // variables. `--pull-to-refresh-distance`/`-transition` move its buttons
    // with the content; `--pull-to-refresh-offset` is the same distance as a
    // number, for CSS that scales by it (the cover zooms to fill the opened
    // area); `--pull-to-refresh-timing` is the spring, set only while springing
    // so nothing else that header animates ever lags. The page content under
    // this wrapper (Profile's own cover) reads `--ptr-offset`/`--ptr-timing`.
    // Never on <html>: a property changed there restyles the whole page.
    const target = pullTargetRefRef.current?.current;
    if (target) {
      target.style.setProperty('--pull-to-refresh-transition', spring);
      target.style.setProperty('--pull-to-refresh-timing', timing);
      target.style.setProperty('--pull-to-refresh-offset', String(d));
      if (d > 0) target.style.setProperty('--pull-to-refresh-distance', `${d}px`);
      else target.style.removeProperty('--pull-to-refresh-distance');
    }
    // The wrapper (the hook's container) is the content's parent.
    const wrapper = content?.parentElement ?? null;
    if (wrapper && target) {
      wrapper.style.setProperty('--ptr-offset', String(d));
      wrapper.style.setProperty('--ptr-timing', timing);
    }

    // Settled at rest: drop the transform and the easing once the spring ends.
    if (d === 0 && !dragging) {
      settleTimerRef.current = window.setTimeout(() => {
        if (content) {
          content.style.transform = 'none';
          content.style.transition = 'none';
        }
        if (gap) {
          gap.style.transform = 'none';
          gap.style.visibility = 'hidden';
        }
        target?.style.setProperty('--pull-to-refresh-timing', '0s');
        wrapper?.style.setProperty('--ptr-timing', '0s');
      }, SPRING_MS);
    }
  }, []);

  const { containerRef, phase, isRefreshing } = usePullToRefresh({
    onRefresh,
    disabled,
    getScrollTop,
    onDistance: paint,
  });
  refreshingRef.current = isRefreshing;

  // Entering or leaving the refreshing state swaps the dial between the
  // finger-driven arc and its CSS spin; repaint at the current distance.
  useLayoutEffect(() => {
    if (dialRef.current && isRefreshing) {
      dialRef.current.style.transform = '';
      if (arcRef.current) arcRef.current.style.strokeDashoffset = '';
    }
  }, [isRefreshing]);

  useLayoutEffect(() => () => {
    window.clearTimeout(settleTimerRef.current);
    const target = pullTargetRef?.current;
    if (!target) return;
    for (const name of [
      '--pull-to-refresh-distance',
      '--pull-to-refresh-transition',
      '--pull-to-refresh-offset',
      '--pull-to-refresh-timing',
    ]) target.style.removeProperty(name);
  }, [pullTargetRef]);

  return (
    <div ref={containerRef} className={styles.root}>
      {surface === 'sheet' && (
        /*
         * Fills the gap the pull opens. Parked above the top edge and moved by
         * the same distance and transition as the content, so its bottom edge
         * is always the content's top edge - the page reads as one surface
         * being pulled, with nothing behind it showing through.
         */
        <div ref={gapRef} className={styles.gap} style={{ visibility: 'hidden' }} aria-hidden="true" />
      )}
      {/*
        The indicator sits ABOVE the content and is revealed by the content
        moving down, rather than being animated into place itself. That is what
        makes the two feel physically connected: one transform, on one element,
        drives the whole effect.
      */}
      <div
        ref={indicatorRef}
        className={`${styles.indicator} ${pullTargetRef ? styles.indicatorOverHeader : ''}`}
        // At rest; painted by `paint` from here on (same values, same curve).
        style={{ transform: 'translate3d(-50%, 0, 0) scale(0.6)', opacity: 0 }}
        aria-hidden="true"
      >
        <div
          ref={dialRef}
          className={`${styles.dial} ${phase === 'ready' ? styles.dialReady : ''} ${
            isRefreshing ? styles.dialSpinning : ''
          }`}
        >
          <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">
            <defs>
              {/*
                The wordmark's own cyan-to-blue, carried on into brand violet.
                A gradient stroke rather than a flat one because this is the
                only moving brand mark in the app, and the three stops are the
                same ones the logo and the app's front door already use.
              */}
              <linearGradient id="ptrStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00C3FF" />
                <stop offset="55%" stopColor="#2E7BFF" />
                <stop offset="100%" stopColor="#5C47FA" />
              </linearGradient>
            </defs>

            <circle
              className={styles.track}
              cx="18"
              cy="18"
              r="15"
              fill="none"
              strokeWidth="1.75"
            />
            <circle
              className={styles.arc}
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="url(#ptrStroke)"
              strokeWidth="1.75"
              strokeLinecap="round"
              // 2πr ≈ 94.2. While pulling, the dash grows with the drag so the
              // ring draws itself; while refreshing, the length is animated in
              // CSS so the arc breathes as it spins.
              strokeDasharray="94.2"
              ref={arcRef}
              strokeDashoffset={94.2}
            />
          </svg>
        </div>
      </div>

      <div ref={contentRef} className={styles.content}>
        {children}
      </div>
    </div>
  );
}
