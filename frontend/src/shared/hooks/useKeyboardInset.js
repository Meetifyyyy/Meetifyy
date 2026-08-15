import { useEffect } from 'react';

/**
 * Tracks the on-screen keyboard via the visualViewport API and exposes its
 * height to CSS as `--kb-inset` on <html>, plus a `data-keyboard-open`
 * attribute.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;
    let raf = 0;
    let last = -1;

    const apply = () => {
      raf = 0;
      // Overlap between the layout viewport bottom and the visual viewport
      // bottom = the space the keyboard is occupying (0 when closed).
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      if (inset === last) return;
      last = inset;
      root.style.setProperty('--kb-inset', `${inset}px`);
      if (inset > 0) root.setAttribute('data-keyboard-open', '');
      else root.removeAttribute('data-keyboard-open');
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);

    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (raf) cancelAnimationFrame(raf);
      root.style.setProperty('--kb-inset', '0px');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);
}
