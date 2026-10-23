/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast }));

import {
  createOfflineNotice, OFFLINE_MESSAGE, ONLINE_MESSAGE, OFFLINE_SETTLE_MS, ONLINE_SETTLE_MS,
} from '../offlineNotice';
import OfflineNotice from '@shared/components/OfflineNotice';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  showToast.mockReset();
});

describe('createOfflineNotice', () => {
  const make = () => {
    const show = vi.fn();
    return { show, notice: createOfflineNotice({ show }) };
  };

  it('says nothing when it starts online', () => {
    const { show, notice } = make();
    notice.start(true);
    vi.advanceTimersByTime(10_000);
    expect(show).not.toHaveBeenCalled();
  });

  it('says it once, straight away, when it starts offline', () => {
    const { show, notice } = make();
    notice.start(false);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(OFFLINE_MESSAGE, 'offline');
  });

  it('waits before announcing a drop during use, and says it once', () => {
    const { show, notice } = make();
    notice.start(true);
    notice.change(false);
    vi.advanceTimersByTime(OFFLINE_SETTLE_MS - 1);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledWith(OFFLINE_MESSAGE, 'offline');
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('says nothing for a dip that recovers inside the settle window', () => {
    const { show, notice } = make();
    notice.start(true);
    notice.change(false);
    vi.advanceTimersByTime(OFFLINE_SETTLE_MS - 100);
    notice.change(true);
    vi.advanceTimersByTime(60_000);
    expect(show).not.toHaveBeenCalled();
  });

  it('says "Back online" only after the offline notice, once the connection holds', () => {
    const { show, notice } = make();
    notice.start(false);
    show.mockClear();
    notice.change(true);
    vi.advanceTimersByTime(ONLINE_SETTLE_MS - 1);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledWith(ONLINE_MESSAGE, 'online');
  });

  it('does not storm when the connection flaps: one offline, one back online', () => {
    const { show, notice } = make();
    notice.start(true);
    notice.change(false);
    vi.advanceTimersByTime(OFFLINE_SETTLE_MS); // offline announced
    // Flap: up for less than the settle time, down again, repeatedly.
    for (let i = 0; i < 5; i += 1) {
      notice.change(true);
      vi.advanceTimersByTime(ONLINE_SETTLE_MS - 200);
      notice.change(false);
      vi.advanceTimersByTime(OFFLINE_SETTLE_MS * 2);
    }
    expect(show).toHaveBeenCalledTimes(1);
    notice.change(true);
    vi.advanceTimersByTime(ONLINE_SETTLE_MS);
    expect(show.mock.calls.map((c) => c[1])).toEqual(['offline', 'online']);
  });

  it('announces a second outage once the first has been closed by "Back online"', () => {
    const { show, notice } = make();
    notice.start(true);
    notice.change(false);
    vi.advanceTimersByTime(OFFLINE_SETTLE_MS);
    notice.change(true);
    vi.advanceTimersByTime(ONLINE_SETTLE_MS);
    notice.change(false);
    vi.advanceTimersByTime(OFFLINE_SETTLE_MS);
    expect(show.mock.calls.map((c) => c[1])).toEqual(['offline', 'online', 'offline']);
  });

  it('dispose cancels a pending notice', () => {
    const { show, notice } = make();
    notice.start(true);
    notice.change(false);
    notice.dispose();
    vi.advanceTimersByTime(10_000);
    expect(show).not.toHaveBeenCalled();
  });
});

describe('<OfflineNotice />', () => {
  let onLine = true;
  const setNetwork = (online) => {
    onLine = online;
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  };
  beforeEach(() => {
    onLine = true;
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  });

  it('opened offline: one short toast', () => {
    onLine = false;
    render(<OfflineNotice />);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe("You're offline");
  });

  it('opened online: silent; goes offline and back: one offline and one back online toast', () => {
    render(<OfflineNotice />);
    expect(showToast).not.toHaveBeenCalled();
    act(() => setNetwork(false));
    act(() => { vi.advanceTimersByTime(OFFLINE_SETTLE_MS); });
    act(() => setNetwork(true));
    act(() => { vi.advanceTimersByTime(ONLINE_SETTLE_MS); });
    expect(showToast.mock.calls.map((c) => c[0])).toEqual([OFFLINE_MESSAGE, ONLINE_MESSAGE]);
  });
});
