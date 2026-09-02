import { describe, expect, it, vi } from 'vitest';
import { createMessageHighlighter } from '../messageHighlight';

const CLASS = 'msgJumpHighlight';

/** Minimal stand-in for a message row; the project has no DOM in tests. */
function fakeEl(id) {
  const classes = new Set();
  return {
    id,
    offsetWidth: 100,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    get highlighted() {
      return classes.has(CLASS);
    },
  };
}

/** Controllable clock, so the 1.8s window can be driven exactly. */
function makeHighlighter(durationMs = 1800) {
  const timers = new Map();
  let nextId = 1;
  const h = createMessageHighlighter({
    className: CLASS,
    durationMs,
    setTimer: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    h,
    /** Fires every timer that is still live. */
    flush: () => {
      const pending = [...timers.entries()];
      timers.clear();
      pending.forEach(([, fn]) => fn());
    },
    pendingCount: () => timers.size,
  };
}

describe('highlighting one message', () => {
  it('applies the class and clears it when the timer fires', () => {
    const { h, flush } = makeHighlighter();
    const a = fakeEl('a');

    h.highlight(a);
    expect(a.highlighted).toBe(true);

    flush();
    expect(a.highlighted).toBe(false);
  });
});

describe('clicking different reply previews in quick succession', () => {
  it('never leaves two messages highlighted at once', () => {
    /**
     * The old code created an untracked timer per flash and removed the class
     * from nothing else, so clicking reply A then reply B lit both, and A went
     * dark 1.8s after ITS click, at a moment unrelated to anything on screen.
     */
    const { h } = makeHighlighter();
    const a = fakeEl('a');
    const b = fakeEl('b');

    h.highlight(a);
    h.highlight(b);

    expect(a.highlighted).toBe(false);
    expect(b.highlighted).toBe(true);
    expect(h.currentElement).toBe(b);
  });

  it('cancels the superseded timer rather than letting it fire later', () => {
    const { h, pendingCount } = makeHighlighter();
    h.highlight(fakeEl('a'));
    h.highlight(fakeEl('b'));
    h.highlight(fakeEl('c'));
    // One live timer, not three.
    expect(pendingCount()).toBe(1);
  });

  it('keeps the newest highlight for its full duration', () => {
    const { h, flush } = makeHighlighter();
    const a = fakeEl('a');
    const b = fakeEl('b');

    h.highlight(a);
    h.highlight(b);
    // Only b's timer remains, so flushing clears b and nothing else breaks.
    flush();
    expect(b.highlighted).toBe(false);
    expect(a.highlighted).toBe(false);
  });
});

describe('clicking the same reply preview repeatedly', () => {
  it('restarts the highlight instead of ending it early', () => {
    /**
     * The specific glitch: the first click's timer used to survive the second
     * click, so it fired part-way through the restarted animation and stripped
     * the class. The highlight flickered out mid-pulse.
     */
    const { h, flush, pendingCount } = makeHighlighter();
    const a = fakeEl('a');

    h.highlight(a);
    h.highlight(a);
    h.highlight(a);

    expect(a.highlighted).toBe(true);
    expect(pendingCount()).toBe(1);

    flush();
    expect(a.highlighted).toBe(false);
  });

  it('forces a reflow so the CSS animation actually restarts', () => {
    // Reading offsetWidth between remove and add is the only thing that stops
    // the browser coalescing the two mutations into no change at all.
    const a = fakeEl('a');
    const reads = [];
    const probed = { ...a, get offsetWidth() { reads.push(1); return 100; } };

    const { h } = makeHighlighter();
    h.highlight(probed);
    expect(reads.length).toBeGreaterThan(0);
  });
});

describe('tearing down', () => {
  it('clears on demand, for a conversation change or unmount', () => {
    // The element is about to be removed from the DOM; a timer that outlived it
    // would touch a detached node.
    const { h, pendingCount } = makeHighlighter();
    const a = fakeEl('a');
    h.highlight(a);

    h.clear();
    expect(a.highlighted).toBe(false);
    expect(pendingCount()).toBe(0);
    expect(h.currentElement).toBeNull();
  });

  it('is safe to clear when nothing is highlighted', () => {
    const { h } = makeHighlighter();
    expect(() => { h.clear(); h.clear(); }).not.toThrow();
  });

  it('ignores a missing element', () => {
    const { h } = makeHighlighter();
    expect(() => h.highlight(null)).not.toThrow();
    expect(h.currentElement).toBeNull();
  });
});
