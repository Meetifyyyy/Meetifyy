/**
 * How a theme switch is shown: a circle of the new theme growing out of the
 * toggle, 800ms, linear, until it covers the screen.
 *
 * That picture is the same everywhere. HOW it is drawn is not, because the
 * cheapest way to draw it differs by runtime:
 *
 *  - Browsers: a View Transition. The old page is a frozen snapshot and the new
 *    one is revealed through a clip-path circle on `::view-transition-new(root)`.
 *    Measured on desktop Chrome the main thread is idle for the whole reveal.
 *  - The Android app: measured on a phone (Chrome 154 WebView, 60 Hz) the same
 *    clip-path is drawn through a full-screen mask that is re-rastered every
 *    frame, which held the reveal to ~48fps, and capturing the snapshots froze
 *    the screen for 180-250ms first. There the shell screenshots the window and
 *    grows a hole in that screenshot natively instead (see
 *    platform/capacitor/themeReveal.js), which also lets it switch the bars'
 *    icons as the circle reaches them.
 *
 * A driver owns one switch from start to finish, including what happens when
 * the toggle is pressed again mid-switch: the circle REVERSES from where it is
 * rather than snapping to the end and starting a new one. The screen never
 * jumps, nothing is captured again, and the theme the user ends on is always
 * the one they last asked for.
 *
 * Contract:
 *   driver.switchTo(theme, { origin: {x, y}, apply })
 *     `theme`  the theme the user now wants ('light' | 'dark')
 *     `origin` the circle's centre, CSS px in the viewport
 *     `apply(theme)` puts a theme on the page (attribute, React state, storage)
 *       synchronously. Drivers call it only at moments the change cannot be
 *       seen: hidden behind a snapshot, or under a fully closed circle.
 *
 * The app installs its driver at startup (`setThemeTransitionDriver`); every
 * other runtime uses the View Transition one.
 */

/** The reveal: identical in every driver. */
export const THEME_REVEAL_MS = 800;

/**
 * The circle's final radius, in CSS px.
 *
 * 160% of the reference length CSS uses for a percentage radius,
 * sqrt(w^2 + h^2) / sqrt(2) of the viewport, so it always passes the farthest
 * corner with margin. The View Transition states it as `circle(160%)`; the
 * native driver needs the same length in pixels.
 */
export function themeRevealRadius(width, height) {
  return 1.6 * (Math.hypot(width, height) / Math.SQRT2);
}

export function viewportSize() {
  return {
    width: window.innerWidth,
    height: window.visualViewport?.height || window.innerHeight,
  };
}

const prefersReducedMotion = () => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
};

/** Runs once the browser is idle, so it never lands in an animating frame. */
const whenIdle = (fn) => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 500 });
  } else {
    setTimeout(fn, 50);
  }
};

/**
 * The View Transition driver.
 *
 * WHAT IT AVOIDS, measured
 *  - Nothing is written to <html> before the transition starts. The origin used
 *    to be set as two custom properties on it, and `theme-transitioning` added,
 *    both before `startViewTransition`: each restyles every element (custom
 *    properties inherit; the class has a `*` rule) and both landed in the frame
 *    that captures the old snapshot. The origin lives only in the animation's
 *    keyframes now, and the class goes on inside the update callback, where it
 *    shares the one restyle the theme change itself causes.
 *  - The class comes off once the browser is idle after the switch, not in the
 *    frame after it, where its full restyle was a dropped frame.
 */
export function createViewTransitionDriver() {
  const root = () => document.documentElement;

  /**
   * The switch in progress:
   *   { from, to, transition, animation, wanted }
   * `wanted` is the theme the user wants now; it differs from `to` while the
   * circle is closing again.
   */
  let current = null;
  let token = 0;

  const clipFrames = (origin) => {
    const { width, height } = viewportSize();
    /*
     * The snapshot resolves a pixel position against its own raster box, which
     * on some Chromium configurations is not the CSS viewport; a percentage of
     * the viewport lands in the same place on both. The radius is a percentage
     * for the same reason, and 160% always reaches the farthest corner.
     */
    const at = `${(origin.x / width) * 100}% ${(origin.y / height) * 100}%`;
    return [`circle(0px at ${at})`, `circle(160% at ${at})`];
  };

  const settle = (id) => {
    whenIdle(() => {
      // A newer switch owns the class now.
      if (id !== token || current) return;
      root().classList.remove('theme-transitioning');
    });
  };

  const start = (theme, { origin, apply }) => {
    const from = root().getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const id = ++token;
    const previous = current;
    const state = { from, to: theme, wanted: theme, transition: null, animation: null };
    current = state;

    const transition = document.startViewTransition(() => {
      // Inside the callback: shares the theme change's restyle (see above).
      root().classList.add('theme-transitioning');
      apply(theme);
    });
    state.transition = transition;
    // Starting a transition ends the previous one at its final frame. Its
    // forwards-filled reveal must go with it: left on <html>, it re-applies
    // its end value to the NEXT transition's pseudo-element, which then shows
    // as already complete.
    previous?.animation?.cancel();

    transition.ready
      .then(() => {
        if (current !== state) return;
        // Pressed again before the circle had even started: there is nothing
        // to undo on screen, so put the old theme back behind the snapshot.
        if (state.wanted !== state.to) {
          apply(state.wanted);
          transition.skipTransition();
          return;
        }
        // Linear, and deliberately so: the radius overshoots the screen, so
        // the visible part is the early part of the timeline, and any eased
        // curve spends it at its fastest - the circle appeared to snap.
        state.animation = root().animate(
          { clipPath: clipFrames(origin) },
          {
            duration: THEME_REVEAL_MS,
            easing: 'linear',
            // Held at full size until the snapshot is torn down; released
            // early, the new snapshot blanks for a frame and the old theme
            // flashes through.
            fill: 'forwards',
            pseudoElement: '::view-transition-new(root)',
          },
        );
        state.animation.finished.then(() => {
          if (current !== state) return;
          // Closed back to nothing: the old theme was put back while the
          // circle shrank, so ending the transition shows exactly what is on
          // screen already.
          if (state.animation.playbackRate < 0) {
            apply(state.wanted);
            transition.skipTransition();
          }
        }, () => {});
      })
      // `ready` rejects when the transition is skipped before it starts.
      .catch(() => {});

    transition.finished
      .catch(() => {})
      .finally(() => {
        if (current !== state) return;
        current = null;
        state.animation?.cancel();
        settle(id);
      });
  };

  return {
    switchTo(theme, options) {
      const { apply } = options;
      if (!document.startViewTransition || prefersReducedMotion()) {
        apply(theme);
        return;
      }

      const state = current;
      if (state) {
        state.wanted = theme;
        const anim = state.animation;
        if (anim && anim.playState === 'running') {
          // Mid-reveal: the circle turns round and heads back the other way
          // from wherever it is. Pressing again turns it round once more.
          const backwards = theme !== state.to;
          if ((anim.playbackRate < 0) !== backwards) anim.reverse();
          return;
        }
        if (!anim) {
          // Still capturing; `ready` reads `wanted` and acts on it.
          return;
        }
        // The reveal has finished and only the teardown is left: an ordinary
        // new switch, which ends that transition at its final frame (no jump).
      }
      start(theme, options);
    },
  };
}

let driver = null;

/** The app's shell replaces the driver at startup; everything else keeps the default. */
export function setThemeTransitionDriver(next) {
  driver = next;
}

export function getThemeTransitionDriver() {
  if (!driver) driver = createViewTransitionDriver();
  return driver;
}
