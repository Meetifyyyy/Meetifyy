import { useRef, useLayoutEffect } from 'react';

/**
 * Transitions a container's height to whatever its content currently needs.
 *
 * The Instant Match steps are very different heights — a twelve-tile grid, a
 * three-card stack, a single input — so moving between them made the sheet
 * jump. Measuring with a ResizeObserver rather than on step changes means the
 * height also follows content that grows on its own: a validation message
 * appearing, a font finishing loading, the keyboard reflowing the input.
 *
 * Returns refs for the animated container and the element to measure.
 */
export function useAnimatedHeight() {
  const containerRef = useRef(null);
  const contentRef = useRef(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return undefined;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let first = true;

    const apply = () => {
      if (media.matches) {
        container.style.height = 'auto';
        return;
      }
      const next = content.getBoundingClientRect().height;
      if (next <= 0) return;
      if (first) {
        // Don't animate up from zero on mount — that reads as a glitch, not
        // as a transition.
        first = false;
        container.style.transition = 'none';
        container.style.height = `${next}px`;
        // Force a reflow so the suppressed transition does not also swallow
        // the next real height change.
        void container.offsetHeight;
        container.style.transition = '';
        return;
      }
      container.style.height = `${next}px`;
    };

    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(content);

    const onMediaChange = () => { first = true; apply(); };
    media.addEventListener?.('change', onMediaChange);

    return () => {
      observer.disconnect();
      media.removeEventListener?.('change', onMediaChange);
    };
  }, []);

  return { containerRef, contentRef };
}
