/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import { render, screen, act, cleanup } from '@testing-library/react';
const nativePlugin = vi.hoisted(() => ({ status: { connected: true, connectionType: 'wifi' } }));
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => nativePlugin.status),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}));

import { createCapacitorNetwork } from '@platform/capacitor/network';
import {
  isOnline,
  subscribeOnline,
  installNetworkStatus,
  useOnlineStatus,
  setNetworkStatusSource,
} from '../networkStatus';

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
  setNetworkStatusSource(null);
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

describe('a native NetworkStatus source (the installed app)', () => {
  function fakeNative(initial) {
    let emit = () => {};
    const service = {
      isOnline: vi.fn(async () => initial),
      onChange: vi.fn((fn) => {
        emit = fn;
        return vi.fn();
      }),
    };
    return { service, emit: (v) => emit(v) };
  }

  it('wins over navigator.onLine once it has answered', async () => {
    onLine = true;
    const native = fakeNative(false);
    setNetworkStatusSource(native.service);
    expect(isOnline()).toBe(true); // not answered yet: the browser flag
    await vi.waitFor(() => expect(isOnline()).toBe(false));
    window.dispatchEvent(new Event('online')); // the WebView's mirror disagrees
    expect(isOnline()).toBe(false);
  });

  it('a native change event drives subscribers, useOnlineStatus and TanStack', async () => {
    const native = fakeNative(true);
    setNetworkStatusSource(native.service);
    installNetworkStatus();
    await vi.waitFor(() => expect(native.service.isOnline).toHaveBeenCalled());
    await Promise.resolve();
    const listener = vi.fn();
    const off = subscribeOnline(listener);
    function Probe() {
      return <p>{useOnlineStatus() ? 'online' : 'offline'}</p>;
    }
    render(<Probe />);

    act(() => native.emit(false));
    expect(listener).toHaveBeenCalledWith(false);
    expect(screen.getByText('offline')).toBeTruthy();
    expect(onlineManager.isOnline()).toBe(false);

    act(() => native.emit(true));
    expect(listener).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('online')).toBeTruthy();
    expect(onlineManager.isOnline()).toBe(true);
    off();
  });

  it('an event that arrives before the first read is not overwritten by it', async () => {
    const native = fakeNative(true);
    setNetworkStatusSource(native.service);
    native.emit(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(isOnline()).toBe(false);
  });

  it('a source that cannot answer leaves the browser fallback in charge', async () => {
    onLine = false;
    setNetworkStatusSource({
      isOnline: async () => {
        throw new Error('no plugin');
      },
      onChange: () => () => {},
    });
    await Promise.resolve();
    expect(isOnline()).toBe(false);
    onLine = true;
    expect(isOnline()).toBe(true);
  });

  it('an unvalidated network (connected=false, but a wifi or cellular connection) is not offline', async () => {
    // What Android reports for a few seconds after a switch, and for good on a
    // network that blocks the system's reachability probe: the browser says
    // online, and the native "not connected" must not override it.
    onLine = true;
    nativePlugin.status = { connected: false, connectionType: 'wifi' };
    setNetworkStatusSource(createCapacitorNetwork());
    await vi.waitFor(() => expect(isOnline()).toBe(true));
    await Promise.resolve();
    expect(isOnline()).toBe(true);
    // No connection of any kind is offline.
    nativePlugin.status = { connected: false, connectionType: 'none' };
    setNetworkStatusSource(createCapacitorNetwork());
    await vi.waitFor(() => expect(isOnline()).toBe(false));
    nativePlugin.status = { connected: true, connectionType: 'wifi' };
  });

  it('removing the source returns to the browser flag', async () => {
    onLine = true;
    setNetworkStatusSource(fakeNative(false).service);
    await vi.waitFor(() => expect(isOnline()).toBe(false));
    setNetworkStatusSource(null);
    expect(isOnline()).toBe(true);
  });
});
