import { useEffect } from 'react';
import { notePostViewed } from '@shared/lib/offlineFeed';

/** At least this much of a post on screen... */
const VISIBLE_RATIO = 0.6;
/** ...for at least this long, or it was only scrolled past. */
const DWELL_MS = 600;

/**
 * Reports each Home post the person actually looked at to the offline feed
 * store (shared/lib/offlineFeed). "Looked at" is a row with 60% of itself on
 * screen for 600ms, or for a post taller than the screen, 60% of the screen.
 * Posts scrolled past quickly, or loaded but never reached, are not reported.
 *
 * Rows are found by `data-post-id` under `containerRef`; a MutationObserver
 * follows the virtual list adding and recycling them. Off when `enabled` is
 * false (search results, the website: nothing listens there anyway).
 */
export function useViewedPosts(containerRef, enabled) {
  useEffect(() => {
    const root = containerRef.current;
    if (!enabled || !root || typeof IntersectionObserver === 'undefined') return undefined;

    const timers = new Map();

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        const id = el.getAttribute('data-post-id');
        if (!id) continue;
        const screenH = entry.rootBounds?.height || window.innerHeight || 1;
        const shown = entry.intersectionRect.height;
        const looked = entry.isIntersecting
          && (entry.intersectionRatio >= VISIBLE_RATIO || shown >= screenH * VISIBLE_RATIO);
        if (looked && !timers.has(el)) {
          timers.set(el, setTimeout(() => {
            timers.delete(el);
            // Reported again on a later visit too: it moves the post up the
            // "most recently viewed" order and refreshes what it showed.
            notePostViewed(id, el);
          }, DWELL_MS));
        } else if (!looked && timers.has(el)) {
          clearTimeout(timers.get(el));
          timers.delete(el);
        }
      }
    }, { threshold: [0, 0.3, VISIBLE_RATIO, 0.9, 1] });

    const watch = (node) => {
      if (!(node instanceof Element)) return;
      if (node.hasAttribute('data-post-id')) io.observe(node);
      node.querySelectorAll?.('[data-post-id]').forEach((el) => io.observe(el));
    };
    watch(root);
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach(watch);
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [containerRef, enabled]);
}

export default useViewedPosts;
