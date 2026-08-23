import { useLayoutEffect } from 'react';

const SCROLLABLE = /(auto|scroll|overlay)/;

/**
 * Freezes background scrolling while an overlay is open.
 *
 * `overflow: hidden` on <body> alone is not enough here: this app scrolls
 * inside nested containers (page bodies, lists, panels), and a wheel event over
 * a fixed overlay still scrolls whichever of those sits underneath. So we walk
 * the app tree and freeze every element that is actually scrollable right now,
 * restoring each element's own inline value on cleanup.
 *
 * Overlays are portalled to <body>, i.e. outside `#root`, so scoping the walk to
 * `#root` cannot freeze a modal's own scrollable regions (the time-slot list,
 * the image grid) — they keep working normally.
 *
 * An overlay that is NOT portalled — the mobile nav drawer lives inside the
 * header — would otherwise have its own scroll frozen along with the page
 * behind it. Marking its root with `data-scroll-lock-ignore` exempts that
 * subtree, so the drawer scrolls while everything under it stays put.
 */
export function useScrollLock(isActive = true) {
  useLayoutEffect(() => {
    if (!isActive || typeof document === 'undefined') return undefined;

    const restore = [];
    const freeze = (el) => {
      if (!el) return;
      restore.push([el, el.style.overflow]);
      el.style.overflow = 'hidden';
    };

    freeze(document.documentElement);
    freeze(document.body);

    const root = document.getElementById('root');
    if (root) {
      root.querySelectorAll('*').forEach((el) => {
        if (el.closest('[data-scroll-lock-ignore]')) return;
        const cs = getComputedStyle(el);
        const y = SCROLLABLE.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
        const x = SCROLLABLE.test(cs.overflowX) && el.scrollWidth > el.clientWidth;
        if (y || x) freeze(el);
      });
    }

    return () => {
      restore.forEach(([el, prev]) => { el.style.overflow = prev; });
    };
  }, [isActive]);
}
