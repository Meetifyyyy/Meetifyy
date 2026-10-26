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
 * `transform` and `clip-path` only, which the compositor animates without
 * touching layout (FLIP):
 *
 *  - expand: the card takes its full height in one frame. It is clipped back to
 *    its old height and the content after it is translated back up by the
 *    difference; both then animate to rest.
 *  - collapse: the layout stays expanded while the card's clip closes and the
 *    content after it slides up. When that finishes the layout collapses in
 *    one frame, which is invisible because everything is already where the
 *    collapsed layout puts it.
 *
 * Returns `layoutExpanded`, which lags `expanded` by the collapse animation and
 * is what the expand container's size must follow.
 *
 * "The content after it" is every following sibling of the composer, then of
 * its parent (the community page nests it one level deeper), skipping
 * out-of-flow elements (the nav bar, a FAB) that do not move with the flow.
 */

const EXPAND_FLIP_MS = 280;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const ASCEND_LEVELS = 1;

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
 * translated by the same difference. The card's shadow layer, if any, moves
 * with the content: it sits on the card's box, so translated by the same
 * difference its bottom edge follows the clip. A collapse holds its end frame
 * (`fill: forwards`) until the collapsed layout has committed.
 */
function playFlip(card, anchor, delta, closing, shadow) {
  const radius = getComputedStyle(card).borderTopLeftRadius || '0px';
  const open = { clipPath: `inset(0px 0px 0px 0px round ${radius})` };
  const shut = { clipPath: `inset(0px 0px ${delta}px 0px round ${radius})` };
  const rest = { transform: 'translateY(0px)' };
  const up = { transform: `translateY(${-delta}px)` };
  const timing = closing
    ? { duration: EXPAND_FLIP_MS, easing: EASING, fill: 'forwards' }
    : { duration: EXPAND_FLIP_MS, easing: EASING };
  const clip = card.animate(closing ? [open, shut] : [shut, open], timing);
  const moved = followingContent(anchor, ASCEND_LEVELS);
  if (shadow) moved.push(shadow);
  const moves = moved.map((el) => el.animate(closing ? [rest, up] : [up, rest], timing));
  return [clip, ...moves];
}

export function useExpandFlip({ expanded, cardRef, anchorRef, shadowRef }) {
  const [layoutExpanded, setLayoutExpanded] = useState(expanded);
  const heightRef = useRef(0); // the card's last laid-out height
  const collapsedHeightRef = useRef(0);
  const animationsRef = useRef([]);
  const prevExpandedRef = useRef(expanded);

  const startFrameRef = useRef(0);

  const cancelAll = () => {
    cancelAnimationFrame(startFrameRef.current);
    animationsRef.current.forEach((a) => a.cancel());
    animationsRef.current = [];
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
    const animate = Boolean(card && anchor && card.animate) && !prefersReducedMotion();

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
        const animations = playFlip(card, anchor, delta, true, shadowRef?.current);
        animationsRef.current = animations;
        animations[0].finished.then(
          // The fill holds the end frame until the collapsed layout has committed;
          // the layout effect below cancels it in that same frame.
          () => setLayoutExpanded(false),
          () => {}, // cancelled by a re-expand
        );
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
    if (!card || !anchor || !card.animate || prefersReducedMotion()) return;
    const full = card.offsetHeight;
    const delta = full - collapsedHeightRef.current;
    if (delta <= 0) return;
    animationsRef.current = playFlip(card, anchor, delta, false, shadowRef?.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutExpanded]);

  useLayoutEffect(() => () => cancelAll(), []);

  return layoutExpanded;
}
