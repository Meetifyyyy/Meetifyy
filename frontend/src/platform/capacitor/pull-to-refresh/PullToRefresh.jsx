import usePullToRefresh from './usePullToRefresh';
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
export default function PullToRefresh({ onRefresh, children, disabled = false, getScrollTop }) {
  const { containerRef, distance, phase, isRefreshing, progress } = usePullToRefresh({
    onRefresh,
    disabled,
    getScrollTop,
  });

  const pulling = phase === 'pulling' || phase === 'ready';

  return (
    <div ref={containerRef} className={styles.root}>
      {/*
        The indicator sits ABOVE the content and is revealed by the content
        moving down, rather than being animated into place itself. That is what
        makes the two feel physically connected: one transform, on one element,
        drives the whole effect.
      */}
      <div
        className={styles.indicator}
        style={{
          transform: `translate3d(-50%, ${distance}px, 0) scale(${0.6 + 0.4 * Math.min(1, distance / 40)})`,
          opacity: Math.min(1, distance / 26),
          /*
           * The SAME transition the content uses, and for the same reason.
           *
           * On release the distance settles from wherever the finger left it
           * to the resting refresh offset. The content animated that change
           * because it had a transition; this element did not, so it jumped
           * there in one frame while the content glided — the indicator
           * visibly snapping upward out of step with the list under it.
           *
           * Both are driven by the same `distance`, so giving them the same
           * transition is what keeps them one object rather than two things
           * that happen to agree while the finger is down.
           */
          transition: pulling
            ? 'none'
            : 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s linear',
        }}
        aria-hidden="true"
      >
        <div
          className={`${styles.dial} ${phase === 'ready' ? styles.dialReady : ''} ${
            isRefreshing ? styles.dialSpinning : ''
          }`}
          style={
            isRefreshing
              ? undefined
              : {
                  // Tracks the finger 1:1 up to the threshold. The arc closing
                  // into a full ring IS the progress readout, so there is no
                  // separate percentage to draw.
                  transform: `rotate(${progress * 270}deg)`,
                }
          }
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
              strokeDashoffset={isRefreshing ? undefined : 94.2 - 94.2 * progress}
            />
          </svg>
        </div>
      </div>

      <div
        className={styles.content}
        style={{
          /*
           * Always a transform, never `undefined` at rest.
           *
           * Dropping the property makes the computed value `none`, and a
           * transition into `none` is the one case browsers handle
           * inconsistently — some interpolate it, some jump. Writing an
           * explicit zero keeps both ends of the transition the same kind of
           * value, so the spring back is always interpolated.
           */
          transform: `translate3d(0, ${distance}px, 0)`,
          /*
           * No transition WHILE dragging — the finger is the animation, and a
           * transition here would make the content lag behind it. The spring
           * back is the only part that is animated.
           */
          transition: pulling ? 'none' : 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
          // Promoted only for the moments it actually moves.
          willChange: distance > 0 ? 'transform' : 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
