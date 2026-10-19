/**
 * The chosen avatar travels from the photo step into the finishing screen.
 *
 * Without it the photo step faded out with its avatar (132px, in the form
 * column), and 180ms later the finishing screen started from nothing with a
 * smaller avatar (96px, centred in the card, on desktop 125px to the left),
 * rising into place on top of its own parent's entrance: the avatar vanished
 * and reappeared somewhere else at another size. The same picture should be on
 * screen throughout, so this carries it: a copy of the avatar circle is held
 * over the photo step while the rest of that screen fades, then glides to where
 * the finishing screen puts its own avatar, and the real one takes over the
 * moment the copy lands.
 *
 * What it moves is a transform on one fixed element (compositor-only; no
 * layout while it travels), for ~360ms. The finishing screen is a plain fade
 * for the same reason: nothing else in that area may be moving when the target
 * is measured, or the copy would land on a position that is no longer true.
 *
 * Markers: `data-avatar-handoff="source"` on the photo step's circle and
 * `="target"` on the finishing screen's. Nothing else is coupled.
 *
 * It is a no-op with reduced motion (the screens simply swap), when there is no
 * source on screen, and when no target ever appears (the copy is removed after
 * WAIT_FOR_TARGET_MS and the page is left as it was).
 */

export const HANDOFF_MS = 360;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** How long to wait for the finishing screen to put its avatar on the page. */
const WAIT_FOR_TARGET_MS = 1200;

const SOURCE = '[data-avatar-handoff="source"]';
const TARGET = '[data-avatar-handoff="target"]';

let active = null;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function finish(run) {
  if (!run || run.ended) return;
  run.ended = true;
  cancelAnimationFrame(run.raf);
  run.animation?.cancel();
  run.clone.remove();
  if (run.target) run.target.style.visibility = '';
  if (active === run) active = null;
}

/**
 * Begins the handoff from the photo step's avatar. Call it where the person
 * confirms ("Finish" / "Skip"), before the screens swap. Returns a cancel
 * function. A second call while one is running is ignored, so a double tap
 * cannot start two copies.
 */
export function startAvatarHandoff() {
  if (typeof document === 'undefined' || active || prefersReducedMotion()) return () => {};
  const source = document.querySelector(SOURCE);
  if (!source) return () => {};

  const from = source.getBoundingClientRect();
  if (!(from.width > 0)) return () => {};

  const clone = source.cloneNode(true);
  clone.removeAttribute('data-avatar-handoff');
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: '0',
    zIndex: '2000',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    willChange: 'transform',
  });
  document.body.appendChild(clone);
  // The original sits exactly under the copy; hiding it keeps the step's own
  // fade-out from showing through, and from sliding out from under the copy.
  source.style.visibility = 'hidden';

  const run = { clone, target: null, animation: null, raf: 0, ended: false };
  active = run;
  const startedAt = performance.now();

  const waitForTarget = () => {
    if (run.ended) return;
    const target = document.querySelector(TARGET);
    if (!target) {
      if (performance.now() - startedAt > WAIT_FOR_TARGET_MS) {
        finish(run);
        return;
      }
      run.raf = requestAnimationFrame(waitForTarget);
      return;
    }

    // The finishing screen only fades in, so its avatar is where it will stay.
    run.target = target;
    target.style.visibility = 'hidden';
    const to = target.getBoundingClientRect();
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const scale = to.width / from.width;

    run.animation = clone.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1)', boxShadow: getComputedStyle(clone).boxShadow },
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`, boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
      ],
      { duration: HANDOFF_MS, easing: EASING, fill: 'forwards' },
    );
    const done = () => finish(run);
    run.animation.onfinish = done;
    run.animation.oncancel = done;
  };

  run.raf = requestAnimationFrame(waitForTarget);
  return () => finish(run);
}
