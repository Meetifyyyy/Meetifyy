import { useLayoutEffect, useState } from 'react';

/**
 * The content size of an element, kept current.
 *
 * Layout that depends on the space an element ACTUALLY has - how many gallery
 * tiles fit, how many rows fill a screen - cannot be decided from a media query:
 * the element is inside a panel whose width is not the window's, and on a phone
 * the browser chrome, the keyboard and the system bars all change its height.
 * Measuring the element itself answers the real question.
 *
 * Reports `{ width: 0, height: 0 }` until the first measurement, which callers
 * treat as "not known yet" rather than "empty".
 */
export function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export default useElementSize;
