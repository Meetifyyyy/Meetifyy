/**
 * Press feedback for tappable controls, one implementation for the whole app.
 *
 * WHY NOT CSS
 * This used to be a global `:active { transform: scale(.96) }`. It could not be
 * smooth: a transition belongs to the element's computed style, and any
 * component that sets its own `transition` (nearly all of them - to fade a
 * colour, say) replaces the list that included `transform`. The scale then
 * applied and was removed in a single frame - a snap on touch-down, a snap on
 * release - and a component that disliked the snap (the bottom bar) could only
 * opt out of its OWN `opacity`, not of the global scale it kept getting.
 *
 * WHAT THIS DOES
 * One delegated listener. On pointer-down it plays a short Web Animation on the
 * control's `scale` property; on release it plays back from wherever it had got
 * to, so a quick tap that ends before the press finishes still eases out instead
 * of jumping. Web Animations are not subject to the element's `transition`
 * list, `scale` composes with an element's own `transform`, and neither
 * property takes part in layout - nothing shifts and nothing reflows.
 *
 * WHAT IT LEAVES ALONE
 *   - disabled controls, and anything inside `[data-no-press]`;
 *   - controls that already style their own pressed state with a transform
 *     (many do): stacking a second scale on theirs compounds into a visible
 *     squash, so if the control's `transform` changes once it is pressed, this
 *     steps aside for the rest of that press - the same deference the old
 *     zero-specificity CSS rule showed;
 *   - large targets (cards, media tiles, list rows): shrinking a photo or a whole
 *     row under the finger is not feedback, it is distortion;
 *   - everything, when the person has asked for reduced motion.
 */

const PRESS_MS = 90;
const RELEASE_MS = 170;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// A control bigger than this is a surface, not a button.
const MAX_HEIGHT = 96;
const MAX_WIDTH = 520;

const TARGET_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  'summary',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
].join(',');

/** How far the control shrinks: the smaller it is, the more it takes to be felt. */
export function pressScaleFor(width) {
  if (width < 120) return 0.92;
  if (width < 260) return 0.95;
  return 0.975;
}

/** Whether a control of this size and state should react to a press. */
export function isPressable(el, size) {
  if (!el) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[data-no-press]')) return false;
  const { width, height } = size;
  if (!width || !height) return false;
  return height <= MAX_HEIGHT && width <= MAX_WIDTH;
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Starts listening. Returns the function that stops it.
 * Safe to call where Web Animations are missing: it then does nothing.
 */
export function installPressFeedback(root = document) {
  if (typeof window === 'undefined' || typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
    return () => {};
  }

  let current = null;

  const release = () => {
    if (!current) return;
    const { animation } = current;
    current = null;
    // Play back from the current progress, a little slower than the press.
    animation.playbackRate = -(PRESS_MS / RELEASE_MS);
    animation.play();
    const done = () => animation.cancel();
    animation.onfinish = done;
    animation.oncancel = null;
  };

  const onDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const el = event.target.closest(TARGET_SELECTOR);
    if (!el || prefersReducedMotion()) return;

    const size = { width: el.offsetWidth, height: el.offsetHeight };
    if (!isPressable(el, size)) return;

    release();
    const transformBefore = getComputedStyle(el).transform;
    const animation = el.animate(
      [{ scale: '1' }, { scale: String(pressScaleFor(size.width)) }],
      { duration: PRESS_MS, easing: EASING, fill: 'forwards' },
    );
    current = { el, animation };

    // `:active` is applied by the browser around this event, so look one frame
    // later: a control that restyles its own transform on press owns the effect.
    requestAnimationFrame(() => {
      if (current?.animation !== animation) return;
      if (getComputedStyle(el).transform !== transformBefore) {
        current = null;
        animation.cancel();
      }
    });
  };

  const opts = { capture: true, passive: true };
  root.addEventListener('pointerdown', onDown, opts);
  // A scroll or drag that takes the gesture away ends in pointercancel.
  root.addEventListener('pointerup', release, opts);
  root.addEventListener('pointercancel', release, opts);
  root.addEventListener('dragstart', release, opts);
  window.addEventListener('blur', release);

  return () => {
    release();
    root.removeEventListener('pointerdown', onDown, opts);
    root.removeEventListener('pointerup', release, opts);
    root.removeEventListener('pointercancel', release, opts);
    root.removeEventListener('dragstart', release, opts);
    window.removeEventListener('blur', release);
  };
}
