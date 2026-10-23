// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAST_LOAD_MS, isImageComplete, loadedQuickly, noteImageStart } from '../imageReveal';

const img = (src) => {
  const el = document.createElement('img');
  if (src) el.setAttribute('src', src);
  return el;
};

describe('imageReveal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('counts an image that loads within the window as cached', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const el = img('https://x/a.webp');
    noteImageStart(el);
    clock.mockReturnValue(1000 + FAST_LOAD_MS - 1);
    expect(loadedQuickly(el)).toBe(true);
  });

  it('counts an image that takes longer as a real download', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const el = img('https://x/a.webp');
    noteImageStart(el);
    clock.mockReturnValue(1000 + FAST_LOAD_MS + 1);
    expect(loadedQuickly(el)).toBe(false);
  });

  it('never assumes an image it did not time was quick', () => {
    expect(loadedQuickly(img('https://x/a.webp'))).toBe(false);
    expect(loadedQuickly(null)).toBe(false);
  });

  it('keeps the first start while the source is unchanged, and restarts for a new one', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const el = img('https://x/a.webp');
    noteImageStart(el);
    // Called again by a later render: the clock must not restart.
    clock.mockReturnValue(1400);
    noteImageStart(el);
    expect(loadedQuickly(el)).toBe(false);
    // A different picture on the same element starts its own clock.
    el.setAttribute('src', 'https://x/b.webp');
    noteImageStart(el);
    expect(loadedQuickly(el)).toBe(true);
  });

  it('reads a cached image as complete only when it has pixels', () => {
    const el = img('https://x/a.webp');
    Object.defineProperty(el, 'complete', { value: true });
    Object.defineProperty(el, 'naturalWidth', { value: 0, configurable: true });
    expect(isImageComplete(el)).toBe(false);
    Object.defineProperty(el, 'naturalWidth', { value: 160, configurable: true });
    expect(isImageComplete(el)).toBe(true);
    expect(isImageComplete(null)).toBe(false);
  });
});
