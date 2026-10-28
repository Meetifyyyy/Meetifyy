import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Expands and collapses the post composer with compositor-only animation.
 *
 * Animating the composer's height (grid-template-rows) re-laid out the card and
 * everything under it on every frame: the feed's rows, HomeCommunities, the
 * pull-to-refresh content. On the phone those frames also carry the tap, the
 * focus render and the keyboard starting, so the box opened in uneven steps and
 * snapped shut however the curve was tuned.
 *
 * Instead the layout changes ONCE, and the in-between frames are drawn with
 * `translate` and `clip-path` only, neither of which touches layout (FLIP):
 *
 *  - expand: the card takes its full height in one frame. It is clipped back to
 *    its old height and the content after it is translated back up by the
 *    difference; both then animate to rest.
 *  - collapse: the layout stays expanded while the card's clip closes and the
 *    content after it slides up. When that finishes the layout collapses in
 *    one frame, which is invisible because everything is already where the
 *    collapsed layout puts it.
 *
 * The clip and the slide are written together, in the same frame, by one
 * per-frame loop. They used to be two Web Animations with the same timing, but
 * a `clip-path` animation runs on the main thread and a `transform` one on the
 * compositor: whenever the main thread was busy (the keyboard closing, the
 * blur, the restyle of the page), the content after the card kept sliding up
 * while the card's edge stood still. The gap under the composer closed, the
 * next card ("Find your communities") ran into it, and the edge then jumped
 * shut when the main thread caught up. Written together they can be late
 * together, never apart.
 *
 * Returns `layoutExpanded`, which lags `expanded` by the collapse animation and
 * is what the expand container's size must follow.
 *
 * "The content after it" is every following sibling of the composer, then of
 * its parent (the community page nests it one level deeper), skipping
 * out-of-flow elements (the nav bar, a FAB) that do not move with the flow.
 */

const EXPAND_FLIP_MS = 280;
const ASCEND_LEVELS = 1;

/** The CSS `cubic-bezier(x1, y1, x2, y2)` timing function, as a function of time. */
export function cubicBezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // x(t) only rises, so halving the interval finds it; 24 steps is far
    // below a pixel over the animation's travel.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

const ease = cubicBezier(0.2, 0, 0, 1);

/**
 * Whether this browser can draw the in-between frames: the slide uses the
 * individual `translate` property. Without it (or without CSS.supports, as in
 * jsdom) the size simply changes in one step.
 */
function canAnimate() {
  try {
    return window.CSS?.supports?.('translate', '0px 1px') === true;
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

function followingContent(start, levels) {
  const out = [];
  // Only what is laid out BELOW the composer moves: a column beside it (a
  // desktop sidebar) is a following sibling too, but its position does not
  // depend on the composer's height.
  const below = start.getBoundingClientRect().top + 1;
  let node = start;
  for (let i = 0; node && i <= levels; i += 1) {
    for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const pos = getComputedStyle(sib).position;
      if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') continue;
      if (sib.getBoundingClientRect().top < below) continue;
      out.push(sib);
    }
    node = node.parentElement;
    if (!node || node === document.body) break;
  }
  return out;
}

/**
 * Plays one expand (`closing` false) or collapse (`closing` true): the card's
 * clip between its collapsed and full height, and the content after it
 * translated by the same difference, both written in the same frame. The
 * card's shadow layer, if any, moves with the content: it sits on the card's
 * box, so translated by the same difference its bottom edge follows the clip.
 *
 * The first frame is drawn at once, so an expand started before paint never
 * shows its full height unclipped. A collapse holds its end frame until
 * `cancel()`, which the hook calls once the collapsed layout has committed.
 * `finished` resolves true when the animation ran to its end, false when it
 * was cancelled first.
 */
export function playFlip(card, anchor, delta, closing, shadow) {
  const radius = getComputedStyle(card).borderTopLeftRadius || '0px';
  const moved = followingContent(anchor, ASCEND_LEVELS);
  if (shadow) moved.push(shadow);

  // Whatever was inline before is put back afterwards.
  const saved = [
    [card, 'clipPath', card.style.clipPath],
    ...moved.flatMap((el) => [
      [el, 'translate', el.style.translate],
      [el, 'willChange', el.style.willChange],
    ]),
  ];
  const restore = () => saved.forEach(([el, prop, value]) => { el.style[prop] = value; });

  // Their own compositor layers for the duration, as an animation would give
  // them, so moving them repaints nothing.
  moved.forEach((el) => { el.style.willChange = 'transform'; });

  // `shut` is how far the card is closed: 0 open, 1 at its collapsed height.
  const draw = (shut) => {
    const px = Math.round(delta * shut * 100) / 100;
    card.style.clipPath = `inset(0px 0px ${px}px 0px round ${radius})`;
    moved.forEach((el) => { el.style.translate = `0px ${-px}px`; });
  };

  let frame = 0;
  let start = null;
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });

  const tick = (now) => {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / EXPAND_FLIP_MS);
    const eased = ease(t);
    draw(closing ? eased : 1 - eased);
    if (t < 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    frame = 0;
    if (!closing) restore();
    settle(true);
  };

  draw(closing ? 0 : 1);
  frame = requestAnimationFrame(tick);

  return {
    finished,
    cancel() {
      cancelAnimationFrame(frame);
      restore();
      settle(false);
    },
  };
}

export function useExpandFlip({ expanded, cardRef, anchorRef, shadowRef }) {
  const [layoutExpanded, setLayoutExpanded] = useState(expanded);
  const heightRef = useRef(0); // the card's last laid-out height
  const collapsedHeightRef = useRef(0);
  const animationRef = useRef(null);
  const prevExpandedRef = useRef(expanded);

  const startFrameRef = useRef(0);

  const cancelAll = () => {
    cancelAnimationFrame(startFrameRef.current);
    animationRef.current?.cancel();
    animationRef.current = null;
  };

  // Track the card's height after every layout, so the expand step knows the
  // height it is starting from without measuring before React commits.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === 'undefined') return undefined;
    heightRef.current = card.offsetHeight;
    const ro = new ResizeObserver(() => { heightRef.current = card.offsetHeight; });
    ro.observe(card);
    return () => ro.disconnect();
  }, [cardRef]);

  useLayoutEffect(() => {
    const was = prevExpandedRef.current;
    prevExpandedRef.current = expanded;
    if (was === expanded) return;

    const card = cardRef.current;
    const anchor = anchorRef.current;
    const animate = Boolean(card && anchor) && canAnimate() && !prefersReducedMotion();

    if (expanded) {
      cancelAll();
      if (!layoutExpanded) {
        // Re-render with the expanded layout; the effect below animates it.
        collapsedHeightRef.current = heightRef.current;
        setLayoutExpanded(true);
      }
      return;
    }

    // Collapse.
    const full = card ? card.offsetHeight : 0;
    const delta = full - (collapsedHeightRef.current || full);
    if (!animate || delta <= 0) {
      cancelAll();
      setLayoutExpanded(false);
      return;
    }
    cancelAll();
    // Start two frames later. A collapse usually comes from the keyboard
    // closing, and that same task blurs the field, drops data-text-entry from
    // <html> (a whole-page restyle) and lets the system-bar sampler run. An
    // animation started inside that frame lost its first ~50ms and opened with
    // a 30px jump. Nothing moves meanwhile: the layout is still expanded.
    startFrameRef.current = requestAnimationFrame(() => {
      startFrameRef.current = requestAnimationFrame(() => {
        const animation = playFlip(card, anchor, delta, true, shadowRef?.current);
        animationRef.current = animation;
        // The end frame is held until the collapsed layout has committed; the
        // layout effect below cancels it in that same frame. A re-expand
        // cancels it first, and then the layout stays expanded.
        void animation.finished.then((completed) => {
          if (completed) setLayoutExpanded(false);
        });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Runs after the layout follows: start the expand animation, or drop the
  // collapse animation's held end frame.
  const prevLayoutRef = useRef(layoutExpanded);
  useLayoutEffect(() => {
    const was = prevLayoutRef.current;
    prevLayoutRef.current = layoutExpanded;
    if (was === layoutExpanded) return;

    if (!layoutExpanded) {
      cancelAll();
      return;
    }

    const card = cardRef.current;
    const anchor = anchorRef.current;
    if (!card || !anchor || !canAnimate() || prefersReducedMotion()) return;
    const full = card.offsetHeight;
    const delta = full - collapsedHeightRef.current;
    if (delta <= 0) return;
    animationRef.current = playFlip(card, anchor, delta, false, shadowRef?.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutExpanded]);

  useLayoutEffect(() => () => cancelAll(), []);

  return layoutExpanded;
}
