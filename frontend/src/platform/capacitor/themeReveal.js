import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  THEME_REVEAL_MS,
  createViewTransitionDriver,
  themeRevealRadius,
  viewportSize,
} from '@shared/theme/themeTransition';

/**
 * The theme switch's circular reveal, drawn by the Android shell.
 *
 * WHY NOT THE VIEW TRANSITION THE WEBSITE USES
 * Measured on the I2208 (Chrome 154 WebView, 60 Hz): the reveal's clip-path is
 * drawn through a full-screen mask that Chrome re-rasters every frame, which
 * kept the GPU thread busy for 736 of 750ms and held the circle to ~48fps
 * (one frame in five dropped). Capturing the two snapshots first froze the
 * screen for 180-250ms. And while a View Transition runs the page cannot
 * hit-test, so the system bars' colours could not be sampled for the new theme.
 *
 * WHAT HAPPENS INSTEAD (ThemeRevealPlugin.java)
 *  1. `begin` - the shell screenshots the window and lays the picture over the
 *     WebView. The screen looks exactly as it did.
 *  2. The new theme is applied to the page underneath, out of sight, and the
 *     bars sample it normally (nothing blocks hit-testing now).
 *  3. `reveal` - once the WebView has painted it, a circular hole grows in the
 *     picture from the toggle: the same circle, origin, radius, 800ms and
 *     linear progression as the website. Each bar's icons switch as the circle
 *     reaches that bar, from the native side, with no bridge round trip.
 *  4. The picture is removed when the circle has passed every corner.
 *
 * Pressing the toggle again mid-reveal reverses the circle from where it is
 * (`reverse`), exactly as the website does. When a reversed circle closes, the
 * picture covers the screen again; the old theme goes back underneath and the
 * picture is removed (`finish`).
 *
 * Wherever the shell cannot do this (iOS, Android below 8, a failed capture)
 * the View Transition driver takes the switch, so the user always gets one.
 */

const ThemeReveal = registerPlugin('ThemeReveal');

const currentTheme = () =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

/** Two frames: the new theme's style, layout and paint have been committed. */
const afterPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const prefersReducedMotion = () => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
};

/**
 * The page's own colour transitions are switched off while a theme changes
 * under the screenshot. Without this every card, background and border faded
 * between the two themes over ~180ms (the UI's hover/press transitions), so
 * the circle uncovered a page half in one theme and half in the other, and
 * after a reversal the screen visibly shifted colour once the picture was
 * removed. The class (global.css) goes on with the theme change, in the same
 * restyle, and comes off once the switch is over and the browser is idle.
 */
const quiet = (apply) => (theme) => {
  document.documentElement.classList.add('theme-transitioning');
  apply(theme);
};

const settleWhenIdle = (isBusy) => {
  const done = () => {
    if (!isBusy()) document.documentElement.classList.remove('theme-transitioning');
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(done, { timeout: 500 });
  else setTimeout(done, 50);
};

export function createNativeThemeRevealDriver({ fallback = createViewTransitionDriver() } = {}) {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('ThemeReveal')) {
    return fallback;
  }

  /** Set once the shell has said it cannot capture; every later switch falls back. */
  let unsupported = false;
  /**
   * The switch in progress:
   *   { from, to, wanted, phase: 'capturing' | 'revealing' | 'closing', forward }
   */
  let busy = null;

  /** Turns a running circle round; retried until the shell's animator exists. */
  const turn = async (state) => {
    for (let i = 0; i < 30 && busy === state && state.phase === 'revealing'; i += 1) {
      const result = await ThemeReveal.reverse().catch(() => ({ state: 'idle' }));
      if (result?.state !== 'idle') return;
      // Still waiting for the WebView's paint before it starts: try next frame.
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  };

  const run = async (theme, { origin, apply: applyTheme }) => {
    const apply = quiet(applyTheme);
    const state = { from: currentTheme(), to: theme, wanted: theme, phase: 'capturing', forward: true };
    busy = state;

    try {
      await ThemeReveal.begin({ x: origin.x, y: origin.y });
    } catch (error) {
      busy = null;
      if (/unsupported/i.test(String(error?.message || error))) unsupported = true;
      fallback.switchTo(state.wanted, { origin, apply: applyTheme });
      return;
    }

    // Pressed again while the screenshot was being taken: nothing has
    // changed on screen, so there is nothing to show.
    if (state.wanted !== state.to) {
      await ThemeReveal.finish().catch(() => {});
      busy = null;
      settleWhenIdle(() => busy !== null);
      return;
    }

    apply(state.to);
    await afterPaint();
    if (state.wanted !== state.to) {
      apply(state.from);
      await afterPaint();
      await ThemeReveal.finish().catch(() => {});
      busy = null;
      settleWhenIdle(() => busy !== null);
      return;
    }

    state.phase = 'revealing';
    const { width, height } = viewportSize();
    let result;
    try {
      result = await ThemeReveal.reveal({
        x: origin.x,
        y: origin.y,
        radius: themeRevealRadius(width, height),
        duration: THEME_REVEAL_MS,
      });
    } catch {
      // The shell gave up mid-way: the page already shows the new theme, so
      // make sure the picture is gone.
      await ThemeReveal.finish().catch(() => {});
      result = { state: 'open' };
    }

    if (result?.state === 'closed') {
      // Reversed all the way: the picture of the old theme covers the screen.
      state.phase = 'closing';
      apply(state.from);
      await afterPaint();
      await ThemeReveal.finish().catch(() => {});
    }
    busy = null;

    // Pressed again in the moments the switch was settling.
    if (state.wanted !== currentTheme()) run(state.wanted, { origin, apply: applyTheme });
    else settleWhenIdle(() => busy !== null);
  };

  return {
    switchTo(theme, options) {
      if (unsupported || prefersReducedMotion()) {
        if (busy) return;
        fallback.switchTo(theme, options);
        return;
      }
      const state = busy;
      if (!state) {
        if (theme !== currentTheme()) run(theme, options);
        return;
      }
      state.wanted = theme;
      if (state.phase === 'revealing') {
        const forward = theme === state.to;
        if (forward !== state.forward) {
          state.forward = forward;
          turn(state);
        }
      }
    },
  };
}
