/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';

// The hook acts only where the keyboard overlays the page (the Android app).
vi.mock('@shared/utils/keyboardOverlay', () => ({ KEYBOARD_OVERLAYS_PAGE: true }));
const { useKeyboardRoom } = await import('../useKeyboardRoom');

function Scroller() {
  const ref = useRef(null);
  useKeyboardRoom(ref);
  return <div ref={ref} data-testid="scroller" />;
}

const ime = (detail) => window.dispatchEvent(new CustomEvent('meetifyy:ime', { detail }));

describe('useKeyboardRoom', () => {
  let el;
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(() => ({ matches: false }));
    const { getByTestId } = render(<Scroller />);
    el = getByTestId('scroller');
    el.scrollTo = vi.fn();
    // A 600px scroller holding 600px of content (room is added on top).
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 600 + (Number.parseFloat(el.style.getPropertyValue('--kb-room')) || 0) });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const room = () => el.style.getPropertyValue('--kb-room');

  it('publishes the keyboard as scroll room the moment it opens', () => {
    act(() => ime({ visible: true, height: 320, duration: 250 }));
    expect(room()).toBe('320px');
  });

  it('releases the room at once when the page was not scrolled', () => {
    act(() => ime({ visible: true, height: 320, duration: 250 }));
    act(() => ime({ visible: false, height: 0, duration: 250 }));
    expect(room()).toBe('0px');
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls back first, and releases the room only when the scroll ends', () => {
    act(() => ime({ visible: true, height: 320, duration: 250 }));
    el.scrollTop = 120;
    act(() => ime({ visible: false, height: 0, duration: 250 }));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    // Still held while it glides.
    expect(room()).toBe('320px');
    act(() => el.dispatchEvent(new Event('scrollend')));
    expect(room()).toBe('0px');
  });

  it('lets the room go after a ceiling if the scroller never reports scrollend', () => {
    act(() => ime({ visible: true, height: 320, duration: 250 }));
    el.scrollTop = 120;
    act(() => ime({ visible: false, height: 0, duration: 250 }));
    expect(room()).toBe('320px');
    act(() => vi.advanceTimersByTime(800));
    expect(room()).toBe('0px');
  });

  it('keeps the room if the keyboard comes back while it is gliding', () => {
    act(() => ime({ visible: true, height: 320, duration: 250 }));
    el.scrollTop = 120;
    act(() => ime({ visible: false, height: 0, duration: 250 }));
    act(() => ime({ visible: true, height: 320, duration: 250 }));
    act(() => el.dispatchEvent(new Event('scrollend')));
    act(() => vi.advanceTimersByTime(800));
    expect(room()).toBe('320px');
  });

  it('does not animate with reduced motion', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    act(() => ime({ visible: true, height: 320, duration: 250 }));
    el.scrollTop = 120;
    act(() => ime({ visible: false, height: 0, duration: 250 }));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    expect(room()).toBe('0px');
  });
});
