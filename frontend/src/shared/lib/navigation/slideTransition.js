/**
 * The slide effect: a page opens by sliding in from the right edge over the
 * current one, which drifts left by a third of its width and dims, with a soft
 * shadow along the new page's leading edge. Closing is the same motion played
 * the other way.
 *
 * This file is only the numbers and the arguments the shell is given. How an
 * effect is chosen, marked on a history entry and handed to the driver is in
 * pageTransition.js; how it is drawn is SlidePageEffect.java.
 */

export const SLIDE_EFFECT = 'slide';

/**
 * The motion. Durations in ms; `curve` is a cubic-bezier; `parallax` is the
 * share of the width the page beneath drifts; `dim` is the black wash over it
 * when fully covered, per theme; the shadow's width is CSS px.
 *
 * The curve starts promptly but not with a jump (about 9% of the way in the
 * first frame) and settles in about 120ms. The first tuning, an iOS-style
 * cubic-bezier(0.32, 0.72, 0, 1) over 460ms, spent its last ~200ms creeping
 * the final 3% of the width; on a phone that read as the page stalling at the
 * edge before it let go.
 */
export const SLIDE_MOTION = Object.freeze({
  open: Object.freeze({ duration: 380, curve: Object.freeze({ x1: 0.3, y1: 0.6, x2: 0.2, y2: 1 }) }),
  close: Object.freeze({ duration: 340, curve: Object.freeze({ x1: 0.3, y1: 0.6, x2: 0.2, y2: 1 }) }),
  parallax: 0.3,
  dim: Object.freeze({ light: 0.14, dark: 0.32 }),
  shadow: Object.freeze({ width: 16, alpha: Object.freeze({ light: 0.12, dark: 0.32 }) }),
});

/** What the shell's `play` is given: the motion, with the dim and shadow for the theme on screen. */
export function slidePlayArgs(direction, dark) {
  const timing = SLIDE_MOTION[direction];
  return {
    effect: SLIDE_EFFECT,
    direction,
    duration: timing.duration,
    curve: { ...timing.curve },
    parallax: SLIDE_MOTION.parallax,
    dim: dark ? SLIDE_MOTION.dim.dark : SLIDE_MOTION.dim.light,
    shadowWidth: SLIDE_MOTION.shadow.width,
    shadowAlpha: dark ? SLIDE_MOTION.shadow.alpha.dark : SLIDE_MOTION.shadow.alpha.light,
  };
}
