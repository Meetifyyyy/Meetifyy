/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

/**
 * Returning to the app re-checks the version only after a real absence.
 *
 * It used to ask the server on every return to the foreground, including a
 * few seconds in another app, which cannot have missed a release.
 */
const get = vi.hoisted(() => vi.fn(async () => ({ minimumVersion: '0.0.0', latestVersion: '0.0.0' })));
vi.mock('../../shared/api/apiClient', () => ({ apiClient: { get } }));
vi.mock('../../platform/capacitor/appInfo', () => ({
  createCapacitorAppInfo: () => ({ appVersion: async () => '1.0.0', platform: () => 'android' }),
}));

const { default: UpdateGate } = await import('../UpdateGate');

let visibility = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const goTo = async (state) => {
  visibility = state;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  get.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UpdateGate on return to the foreground', () => {
  it('does not re-check after a short trip to another app', async () => {
    await act(async () => { render(<UpdateGate><p>app</p></UpdateGate>); });
    expect(get).toHaveBeenCalledTimes(1);
    await goTo('hidden');
    vi.advanceTimersByTime(60_000);
    await goTo('visible');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('re-checks after a few minutes away', async () => {
    await act(async () => { render(<UpdateGate><p>app</p></UpdateGate>); });
    await goTo('hidden');
    vi.advanceTimersByTime(6 * 60_000);
    await goTo('visible');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
