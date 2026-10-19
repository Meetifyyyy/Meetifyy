/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppIdle, resetAppIdleForTests } from '../useAppIdle';

describe('useAppIdle', () => {
  let idleCallbacks;
  beforeEach(() => {
    resetAppIdleForTests();
    idleCallbacks = [];
    window.requestIdleCallback = vi.fn((cb) => { idleCallbacks.push(cb); return idleCallbacks.length; });
  });
  afterEach(() => { delete window.requestIdleCallback; });

  it('is false on the first render and true once the browser goes idle', () => {
    const { result } = renderHook(() => useAppIdle());
    expect(result.current).toBe(false);
    act(() => idleCallbacks.forEach((cb) => cb()));
    expect(result.current).toBe(true);
  });

  it('schedules one idle callback however many components ask', () => {
    renderHook(() => useAppIdle());
    renderHook(() => useAppIdle());
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);
  });

  it('stays true for components that mount later', () => {
    renderHook(() => useAppIdle());
    act(() => idleCallbacks.forEach((cb) => cb()));
    const { result } = renderHook(() => useAppIdle());
    expect(result.current).toBe(true);
  });

  it('falls back to a short timer without requestIdleCallback', () => {
    delete window.requestIdleCallback;
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppIdle());
    act(() => vi.advanceTimersByTime(1300));
    expect(result.current).toBe(true);
    vi.useRealTimers();
  });
});
