/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * Freezing the page must not steal `position: sticky` from the window.
 *
 * `overflow: hidden` makes an element a scroll container, and `<html>` is
 * deliberately not one — global.css keeps it that way with `overflow-x: clip`
 * and explains at length that a scrolling `<html>` becomes the sticky anchor
 * for everything beneath it, whose own scrollTop never moves.
 *
 * Locking the root with `hidden` re-created exactly that. Both the left sidebar
 * and the right panel are `position: sticky; top: 60px`, so opening any overlay
 * re-bound them to `<html>` and they rendered at their natural document
 * position instead of their stuck one. Measured in a browser at 1400x900,
 * scrolled to y=800: both moved from `top: 60` to `top: -740` — a full 800px
 * off the top of the screen — and returned when it closed.
 *
 * jsdom does no layout, so these assert the mechanism that produced it: which
 * overflow value each element is frozen with. The displacement itself was
 * measured in a real browser, along with the fact that `clip` blocks user
 * scrolling exactly as `hidden` does.
 */
const { useScrollLock } = await import('../useScrollLock');

const styleOf = (el) => el.style.overflow;

describe('scroll lock and sticky positioning', () => {
  afterEach(() => {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.getElementById('root')?.remove();
  });

  it('clips the root rather than hiding it, so sticky keeps its window anchor', () => {
    const { unmount } = renderHook(() => useScrollLock(true));
    expect(styleOf(document.documentElement)).toBe('clip');
    expect(styleOf(document.body)).toBe('clip');
    unmount();
  });

  it('restores exactly what was there before', () => {
    document.documentElement.style.overflow = '';
    const { unmount } = renderHook(() => useScrollLock(true));
    unmount();
    // Back to the stylesheet's value, not to a value this hook invented.
    expect(styleOf(document.documentElement)).toBe('');
    expect(styleOf(document.body)).toBe('');
  });

  it('still hides inner scroll containers, which must stay scroll containers', () => {
    // `clip` on these would stop them being scrollable at all, forcing their
    // own scrollTop to 0 and jumping their content to the top for as long as
    // the overlay is open.
    const root = document.createElement('div');
    root.id = 'root';
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    root.appendChild(scroller);
    document.body.appendChild(root);

    const { unmount } = renderHook(() => useScrollLock(true));
    expect(styleOf(scroller)).toBe('hidden');
    expect(styleOf(document.documentElement)).toBe('clip');
    unmount();
    expect(styleOf(scroller)).toBe('');
  });

  it('leaves everything alone when inactive', () => {
    renderHook(() => useScrollLock(false));
    expect(styleOf(document.documentElement)).toBe('');
    expect(styleOf(document.body)).toBe('');
  });
});
