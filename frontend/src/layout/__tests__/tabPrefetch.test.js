/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTabPrefetcher } from '../tabPrefetch';

afterEach(() => {
  vi.restoreAllMocks();
  delete window.requestIdleCallback;
  delete window.cancelIdleCallback;
  Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
});

const loaders = () => ({
  home: vi.fn(() => Promise.resolve({})),
  campus: vi.fn(() => Promise.resolve({})),
});

describe('tab prefetch', () => {
  it('starts a tab\'s download on press, hover and focus - not only hover', () => {
    const l = loaders();
    const { handlersFor } = createTabPrefetcher(l);
    const h = handlersFor('campus');

    h.onPointerDown();
    h.onMouseEnter();
    h.onFocus();

    expect(l.campus).toHaveBeenCalledTimes(3); // the import itself is cached; asking again is free
    expect(l.home).not.toHaveBeenCalled();
  });

  it('ignores an unknown tab and swallows a failed (offline) download', async () => {
    const l = { home: vi.fn(() => Promise.reject(new Error('offline'))) };
    const { warm } = createTabPrefetcher(l);
    expect(() => warm('nowhere')).not.toThrow();
    expect(() => warm('home')).not.toThrow();
    await Promise.resolve();
  });

  it('survives a loader that throws synchronously', () => {
    const { warm } = createTabPrefetcher({ home: () => { throw new Error('boom'); } });
    expect(() => warm('home')).not.toThrow();
  });

  it('warms every tab from idle time, and can be cancelled', () => {
    const l = loaders();
    let idle;
    window.requestIdleCallback = vi.fn((cb) => { idle = cb; return 7; });
    window.cancelIdleCallback = vi.fn();
    const { warmAllWhenIdle } = createTabPrefetcher(l);

    const cancel = warmAllWhenIdle();
    expect(l.home).not.toHaveBeenCalled(); // not during the current task
    idle();
    expect(l.home).toHaveBeenCalledTimes(1);
    expect(l.campus).toHaveBeenCalledTimes(1);

    cancel();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('does not prefetch on Data Saver or a 2g link', () => {
    for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
      Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
      window.requestIdleCallback = vi.fn();
      const { warmAllWhenIdle } = createTabPrefetcher(loaders());
      warmAllWhenIdle();
      expect(window.requestIdleCallback).not.toHaveBeenCalled();
    }
  });

  it('falls back to the next task where idle callbacks do not exist', () => {
    vi.useFakeTimers();
    const l = loaders();
    const { warmAllWhenIdle } = createTabPrefetcher(l);
    warmAllWhenIdle();
    expect(l.home).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(l.home).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
