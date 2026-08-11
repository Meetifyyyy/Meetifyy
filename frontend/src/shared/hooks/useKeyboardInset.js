import { useEffect } from 'react';

/**
 * Tracks the on-screen keyboard via the visualViewport API and exposes its
 * height to CSS as `--kb-inset` on <html>, plus a `data-keyboard-open`
 * attribute. Mobile browsers do NOT shrink `100dvh` when the soft keyboard
 * opens (the keyboard is an overlay), so a fixed-height chat layout would let
 * the keyboard cover the input. Reading `visualViewport.height` lets us shrink
 * the chat container by exactly the keyboard's height so the input stays just
 * above it and the header stays pinned at the top.
 *
 * Writes are rAF-batched and value-deduped so a keyboard animation (which fires
 * many resize events) causes at most one style write per frame — no flicker,
 * no re-render (this only touches a CSS custom property, never React state).
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
