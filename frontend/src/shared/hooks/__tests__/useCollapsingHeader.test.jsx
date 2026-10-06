/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCollapsingHeader } from '../useCollapsingHeader';

describe('useCollapsingHeader cover transition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.scrollY;
    document.documentElement.removeAttribute('data-collapsing-header');
    document.documentElement.removeAttribute('data-status-bar-icons');
    document.documentElement.style.removeProperty('--profile-collapse');
    document.documentElement.style.removeProperty('--profile-cover-height');
  });

  // The cover scrolls away with the page and pins at the header's height,
  // crossfading into its blurred copy. It used to be squashed with scaleY.
  it('scrolls the existing cover away and blurs it through intermediate and reverse positions', () => {
    let scrollY = 0;
    let nextFrame = null;
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    });

    const header = document.createElement('div');
    const coverPlaceholder = document.createElement('div');
    Object.defineProperties(header, { offsetHeight: { value: 80 } });
    coverPlaceholder.getBoundingClientRect = () => ({ height: 200 });

    const headerRef = { current: header };
    const coverRef = { current: coverPlaceholder };
    const runPendingFrame = () => {
      const callback = nextFrame;
      nextFrame = null;
      callback?.();
    };

    const { unmount } = renderHook(() => useCollapsingHeader({
      enabled: true,
      headerRef,
      coverRef,
      coverBackground: true,
    }));

    expect(document.documentElement.style.getPropertyValue('--profile-cover-height')).toBe('200px');
    expect(header.style.getPropertyValue('--cover-h')).toBe('200');
    expect(header.style.getPropertyValue('--cover-shift')).toBe('0');
    expect(header.style.getPropertyValue('--cover-blur')).toBe('0.000');

    act(() => {
      scrollY = 60;
      window.dispatchEvent(new Event('scroll'));
      runPendingFrame();
    });
    expect(header.style.getPropertyValue('--collapse')).toBe('0.500');
    expect(header.style.getPropertyValue('--cover-shift')).toBe('60');
    expect(header.style.getPropertyValue('--cover-blur')).toBe('0.500');

    act(() => {
      scrollY = 120;
      window.dispatchEvent(new Event('scroll'));
      runPendingFrame();
    });
    expect(header.style.getPropertyValue('--collapse')).toBe('1.000');
    expect(header.style.getPropertyValue('--cover-shift')).toBe('120');
    expect(header.style.getPropertyValue('--cover-blur')).toBe('1.000');

    act(() => {
      scrollY = 30;
      window.dispatchEvent(new Event('scroll'));
      runPendingFrame();
    });
    expect(header.style.getPropertyValue('--collapse')).toBe('0.250');
    expect(header.style.getPropertyValue('--cover-shift')).toBe('30');
    expect(header.style.getPropertyValue('--cover-blur')).toBe('0.156');

    // Past the pin point the cover stays put as the header's background.
    act(() => {
      scrollY = 400;
      window.dispatchEvent(new Event('scroll'));
      runPendingFrame();
    });
    expect(header.style.getPropertyValue('--cover-shift')).toBe('120');
    expect(header.style.getPropertyValue('--cover-blur')).toBe('1.000');

    unmount();
    expect(document.documentElement.hasAttribute('data-collapsing-header')).toBe(false);
  });

  it('re-measures when the cover resizes without a window resize (status-bar inset)', () => {
    let nextFrame = null;
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const observers = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 });

    let coverHeight = 120;
    const header = document.createElement('div');
    const coverPlaceholder = document.createElement('div');
    Object.defineProperty(header, 'offsetHeight', { value: 56 });
    coverPlaceholder.getBoundingClientRect = () => ({ height: coverHeight });

    renderHook(() => useCollapsingHeader({
      enabled: true,
      headerRef: { current: header },
      coverRef: { current: coverPlaceholder },
      coverBackground: true,
    }));
    expect(document.documentElement.style.getPropertyValue('--profile-cover-height')).toBe('120px');

    act(() => {
      coverHeight = 152; // the inset arrived and the placeholder grew
      observers.forEach((o) => o.callback([]));
      const callback = nextFrame;
      nextFrame = null;
      callback?.();
    });
    expect(document.documentElement.style.getPropertyValue('--profile-cover-height')).toBe('152px');
    expect(header.style.getPropertyValue('--cover-h')).toBe('152');
  });
});

describe('shared cover attributes', () => {
  it('stay while any cover page is mounted, whatever order they leave in', async () => {
    // Earlier tests leave their hooks mounted; unmount them so the count starts at zero.
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    const root = document.documentElement;
    root.setAttribute('data-status-bar-icons', 'dark');
    const make = () => {
      const header = document.createElement('div');
      const cover = document.createElement('div');
      document.body.append(header, cover);
      return renderHook(() => useCollapsingHeader({ enabled: true, headerRef: { current: header }, coverRef: { current: cover } }));
    };
    const a = make();
    const b = make(); // the next cover page mounts before the first has left
    a.unmount();
    expect(root.hasAttribute('data-collapsing-header')).toBe(true);
    b.unmount();
    expect(root.hasAttribute('data-collapsing-header')).toBe(false);
    expect(root.getAttribute('data-status-bar-icons')).toBe('dark');
    root.removeAttribute('data-status-bar-icons');
  });
});
