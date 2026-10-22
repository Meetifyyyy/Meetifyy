/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import { render, screen, act, cleanup } from '@testing-library/react';
import { isOnline, subscribeOnline, installNetworkStatus, useOnlineStatus } from '../networkStatus';

/**
 * One answer to "is there a network", handed to TanStack so queries pause and
 * resume with the same signal the UI uses. TanStack v5 starts out believing it
 * is online whatever the browser says, which is the bug `installNetworkStatus`
 * exists to fix.
 */

let onLine = true;
const onLineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);

function setNetwork(online) {
  onLine = online;
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

afterEach(() => {
  cleanup();
  onLine = true;
  installNetworkStatus();
});

describe('isOnline / subscribeOnline', () => {
  it('reads the browser flag', () => {
    onLine = false;
    expect(isOnline()).toBe(false);
    onLine = true;
    expect(isOnline()).toBe(true);
    expect(onLineSpy).toHaveBeenCalled();
  });

  it('tells a listener about each change once, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribeOnline(listener);
    setNetwork(false);
    setNetwork(false); // a repeat of the same state says nothing new
    setNetwork(true);
    expect(listener.mock.calls).toEqual([[false], [true]]);
    off();
    setNetwork(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('re-reads the flag when the page becomes visible (a missed event while backgrounded)', () => {
    const listener = vi.fn();
    const off = subscribeOnline(listener);
    onLine = false; // no 'offline' event reached the page
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledWith(false);
    off();
  });

  it('useOnlineStatus re-renders on change', () => {
    function Probe() {
      return <p>{useOnlineStatus() ? 'online' : 'offline'}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('online')).toBeTruthy();
    act(() => setNetwork(false));
    expect(screen.getByText('offline')).toBeTruthy();
    act(() => setNetwork(true));
    expect(screen.getByText('online')).toBeTruthy();
  });
});

describe('installNetworkStatus: TanStack follows the device', () => {
  it('starts offline when the device is offline at launch', () => {
    onLine = false;
    installNetworkStatus();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('follows online/offline events', () => {
    installNetworkStatus();
    expect(onlineManager.isOnline()).toBe(true);
    act(() => setNetwork(false));
    expect(onlineManager.isOnline()).toBe(false);
    act(() => setNetwork(true));
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('pauses a query offline (its cached data stays, no error) and runs it on reconnect', async () => {
    onLine = false;
    installNetworkStatus();
    const client = new QueryClient();
    // What QueryClientProvider does: subscribes the cache to onlineManager.
    client.mount();
    client.setQueryData(['cached'], 'saved on this device');
    const queryFn = vi.fn(async () => 'fresh');

    const observer = new QueryObserver(client, { queryKey: ['cached'], queryFn, staleTime: 0 });
    const unsubscribe = observer.subscribe(() => {});
    await Promise.resolve();

    // What a screen reads: the saved data, a paused fetch, and no error.
    const paused = observer.getCurrentResult();
    expect(queryFn).not.toHaveBeenCalled();
    expect(paused.fetchStatus).toBe('paused');
    expect(paused.data).toBe('saved on this device');
    expect(paused.isError).toBe(false);

    act(() => setNetwork(true));
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('fresh'));
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
    client.unmount();
    client.clear();
  });
});
