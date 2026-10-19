// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureScrollAnchor, restoreScrollAnchor } from '../scrollAnchor';

/*
 * A fake scroller with real-enough geometry: rows of fixed height stacked in
 * DOM order, positioned by the scroller's scrollTop, and a scrollTop clamped
 * like a browser's. `browserAnchors` mimics Chromium's overflow-anchor:auto,
 * which shifts scrollTop itself when content is inserted above the viewport.
 */
function makeScroller({ rows, rowHeight = 40, clientHeight = 400 }) {
  const container = document.createElement('div');
  let scrollTop = 0;
  const maxScroll = () => Math.max(0, container.children.length * rowHeight - clientHeight);
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => { scrollTop = Math.min(Math.max(0, v), maxScroll()); },
  });
  Object.defineProperty(container, 'scrollHeight', { get: () => container.children.length * rowHeight });
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight });
  container.getBoundingClientRect = () => ({ top: 0, bottom: clientHeight });
  const add = (ids, atStart) => {
    const frag = document.createDocumentFragment();
    ids.forEach((id) => {
      const el = document.createElement('div');
      el.setAttribute('data-message-id', id);
      el.getBoundingClientRect = () => {
        const index = Array.prototype.indexOf.call(container.children, el);
        const top = index * rowHeight - scrollTop;
        return { top, bottom: top + rowHeight };
      };
      frag.appendChild(el);
    });
    if (atStart) container.insertBefore(frag, container.firstChild); else container.appendChild(frag);
  };
  add(rows, false);
  return {
    container,
    prepend(ids, { browserAnchors }) {
      const before = container.scrollHeight;
      add(ids, true);
      if (browserAnchors) container.scrollTop += container.scrollHeight - before;
    },
  };
}

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('scroll anchoring when older messages are prepended', () => {
  for (const browserAnchors of [true, false]) {
    it(`keeps the reader's message in place (browser anchoring ${browserAnchors ? 'on' : 'off'})`, () => {
      const { container, prepend } = makeScroller({ rows: ids('new', 50) });
      container.scrollTop = 100; // reader near the top, where the load triggers
      const anchor = captureScrollAnchor(container);
      expect(anchor).toEqual({ id: 'new2', offset: -20 });

      prepend(ids('old', 50), { browserAnchors });
      restoreScrollAnchor(container, anchor);

      // Same message, same offset: 50 rows of 40px were added above it.
      expect(container.scrollTop).toBe(2100);
      expect(captureScrollAnchor(container)).toEqual(anchor);
      // The bug: the old code added the height growth on top of the browser's
      // own shift, clamping to the very bottom (3600) - the "snap".
      expect(container.scrollTop).toBeLessThan(container.scrollHeight - container.clientHeight);
    });
  }

  it('does nothing when the anchor message is gone', () => {
    const { container } = makeScroller({ rows: ids('m', 20) });
    container.scrollTop = 80;
    expect(restoreScrollAnchor(container, { id: 'missing', offset: 0 })).toBe(0);
    expect(container.scrollTop).toBe(80);
  });
});
