import { useLayoutEffect, useRef } from 'react';

/**
 * Animates a container's height whenever its content's height changes, so a
 * reflow (an attachment removed, a layout switching from a row to a single
 * image) glides instead of jumping.
 *
 * Attach `outerRef` to the wrapper and `innerRef` to the element inside it
 * that holds the content. Only the wrapper's height is animated — one
 * property on one element — and only for the length of the change; the rest
 * of the time the wrapper is plain `height: auto` and costs nothing.
 *
 * Why ResizeObserver: its callbacks run after layout but before paint, so the
 * wrapper is pinned back to its old height in the same frame the content
 * changed — the new size is never painted unanimated, which is what removes
 * the jump rather than just softening it.
 */
export function useSmoothHeight({ durationMs = 220 } = {}) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return undefined;

    const reduce = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = inner.offsetHeight;
    let endTimer = 0;

    const finish = () => {
      outer.style.height = '';
      outer.style.overflow = '';
      outer.style.transition = '';
    };

    const observer = new ResizeObserver(() => {
      const next = inner.offsetHeight;
      const from = outer.style.height ? outer.getBoundingClientRect().height : last;
      last = next;
      if (reduce || Math.abs(from - next) < 1) return;

      clearTimeout(endTimer);
      outer.style.transition = 'none';
      outer.style.overflow = 'hidden';
      outer.style.height = `${from}px`;
      // Commit the start height before starting the transition from it.
      void outer.offsetHeight;
      outer.style.transition = `height ${durationMs}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      outer.style.height = `${next}px`;
      // A timer rather than `transitionend`: the event does not fire when the
      // transition is interrupted or the element is hidden, which would leave
      // the wrapper pinned at a fixed height.
      endTimer = window.setTimeout(finish, durationMs + 40);
    });

    observer.observe(inner);
    return () => {
      observer.disconnect();
      clearTimeout(endTimer);
      finish();
    };
  }, [durationMs]);

  return { outerRef, innerRef };
}

export default useSmoothHeight;
