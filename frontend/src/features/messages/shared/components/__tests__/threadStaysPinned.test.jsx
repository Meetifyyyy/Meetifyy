/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => ({ src: value || '', failed: false, pending: false, attempt: 0, refresh: vi.fn() }),
}));

import ChatMessageList from '../ChatMessageList';

/**
 * When the thread's own box changes height - the composer grew because a reply
 * bar opened above it, a window resized - its content does not, so the old
 * observer (which only looked at content height) did nothing, and a reader at
 * the bottom was left with the latest messages pushed out of view. The thread
 * now stays on the latest message if that is where the reader was, and leaves
 * a reader who is up in the history exactly where they are.
 */
let observers;
beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { observers = observers.filter((o) => o !== this); }
  };
});
afterEach(() => {
  cleanup();
  delete globalThis.ResizeObserver;
});

const SCROLL_HEIGHT = 2000;
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const messages = [
  { id: 'a', senderId: 'u-me', from: 'me', status: 'read', createdAt: minutesAgo(3), text: 'first' },
  { id: 'b', senderId: 'u-a', status: 'read', createdAt: minutesAgo(2), text: 'second' },
];

/** The list, with a scroller whose geometry the test controls. */
function mountThread() {
  const client = new QueryClient();
  const ui = (list) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatMessageList messages={list} conversation={{ id: 'c1' }} currentUser={{ id: 'u-me' }} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { container, rerender } = render(ui(messages));
  // On mount the list clears its "already scrolled to the bottom" flag; in the
  // app the thread's messages arriving is what sets it again. Do the same.
  rerender(ui([...messages]));
  const thread = container.firstChild;
  const state = { scrollTop: 0, clientHeight: 600 };
  Object.defineProperty(thread, 'scrollTop', { get: () => state.scrollTop, set: (v) => { state.scrollTop = v; }, configurable: true });
  Object.defineProperty(thread, 'clientHeight', { get: () => state.clientHeight, configurable: true });
  Object.defineProperty(thread, 'scrollHeight', { get: () => SCROLL_HEIGHT, configurable: true });
  const notifyResize = () => observers.forEach((o) => o.cb());
  const scrollTo = (top) => { state.scrollTop = top; fireEvent.scroll(thread); };
  return { state, notifyResize, scrollTo };
}

describe('a thread whose box is resized', () => {
  it('stays on the latest message when the reader was at the bottom', () => {
    const { state, notifyResize, scrollTo } = mountThread();
    notifyResize();                       // the first reading of its height
    scrollTo(SCROLL_HEIGHT - 600);        // at the bottom
    state.clientHeight = 541;             // a 59px reply bar opened below it
    notifyResize();
    expect(state.scrollTop).toBeGreaterThanOrEqual(SCROLL_HEIGHT);
  });

  it('stays there when the box grows back (the reply was dismissed)', () => {
    const { state, notifyResize, scrollTo } = mountThread();
    notifyResize();
    scrollTo(SCROLL_HEIGHT - 600);
    state.clientHeight = 541;
    notifyResize();
    scrollTo(SCROLL_HEIGHT - 541);
    state.clientHeight = 600;
    notifyResize();
    expect(state.scrollTop).toBeGreaterThanOrEqual(SCROLL_HEIGHT);
  });

  it('leaves a reader who is up in the history where they are', () => {
    const { state, notifyResize, scrollTo } = mountThread();
    notifyResize();
    scrollTo(SCROLL_HEIGHT - 600);
    state.clientHeight = 541;
    notifyResize();                       // pinned, which also records the scroll height
    scrollTo(100);                        // the reader scrolls well up
    state.clientHeight = 480;             // and the box shrinks again
    notifyResize();
    expect(state.scrollTop).toBe(100);
  });

  it('does nothing when only the content changed and the box did not', () => {
    const { state, notifyResize, scrollTo } = mountThread();
    notifyResize();
    scrollTo(SCROLL_HEIGHT - 600);
    state.scrollTop = 1234;               // moved by something else; no box change
    notifyResize();
    expect(state.scrollTop).toBe(1234);
  });
});
