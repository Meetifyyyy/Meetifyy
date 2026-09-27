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
    document.documentElement.style.removeProperty('--profile-cover-scale');
  });

  it('smoothly scales the existing cover through intermediate and reverse scroll positions', () => {
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
    Object.defineProperties(coverPlaceholder, { offsetHeight: { value: 200 } });

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
    expect(document.documentElement.style.getPropertyValue('--profile-cover-scale')).toBe('1.0000');

    act(() => {
      scrollY = 60;
      window.dispatchEvent(new Event('scroll'));
      runPendingFrame();
    });
    expect(header.style.getPropertyValue('--collapse')).toBe('0.500');
    expect(document.documentElement.style.getPropertyValue('--profile-cover-scale')).toBe('0.7000');

    act(() => {
      scrollY = 120;
      window.dispatchEvent(new Event('scroll'));
      runPendingFrame();
    });
    expect(header.style.getPropertyValue('--collapse')).toBe('1.000');
    expect(document.documentElement.style.getPropertyValue('--profile-cover-scale')).toBe('0.4000');

    act(() => {
      scrollY = 30;
      window.dispatchEvent(new Event('scroll'));
      runPendingFrame();
    });
    expect(header.style.getPropertyValue('--collapse')).toBe('0.250');
    expect(document.documentElement.style.getPropertyValue('--profile-cover-scale')).toBe('0.8500');

    unmount();
    expect(document.documentElement.hasAttribute('data-collapsing-header')).toBe(false);
  });
});
