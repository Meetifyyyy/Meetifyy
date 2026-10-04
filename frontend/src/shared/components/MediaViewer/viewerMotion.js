/**
 * One reading of the user's motion preference for everything the viewer moves.
 *
 * The slide track, the snap-back after a cancelled drag, the dismiss fly-out,
 * the double-tap zoom and the pan momentum are all driven from script, so the
 * stylesheet's `prefers-reduced-motion` block cannot reach them on its own. They
 * all ask here instead.
 *
 * It reads `matchMedia` on every call rather than caching: the preference can
 * change while the viewer is open, and the query is cheap. Missing or partial
 * `matchMedia` implementations (older WebViews, jsdom) mean "no preference".
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

export const MOTION_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

/**
 * A CSS `transition` value for a scripted move, or `'none'` when the user asked
 * for reduced motion - the move then lands instantly instead of being skipped.
 */
export function motionTransition(property, seconds, easing = MOTION_EASE) {
  return prefersReducedMotion() ? 'none' : `${property} ${seconds}s ${easing}`;
}
