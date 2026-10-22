import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listeners = {};
const remove = vi.fn();
const plugin = {
  getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
  addListener: vi.fn(async (name, fn) => {
    listeners[name] = fn;
    return { remove };
  }),
};
vi.mock('@capacitor/network', () => ({ Network: plugin }));

const { createCapacitorNetwork } = await import('../network');

describe('Capacitor NetworkStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the native state', async () => {
    const net = createCapacitorNetwork();
    expect(await net.isOnline()).toBe(true);
    plugin.getStatus.mockResolvedValueOnce({ connected: false, connectionType: 'none' });
    expect(await net.isOnline()).toBe(false);
  });

  it('turns networkStatusChange into online/offline and detaches on unsubscribe', async () => {
    const net = createCapacitorNetwork();
    const fn = vi.fn();
    const off = net.onChange(fn);
    await Promise.resolve();
    listeners.networkStatusChange({ connected: false, connectionType: 'none' });
    listeners.networkStatusChange({ connected: true, connectionType: 'cellular' });
    expect(fn.mock.calls).toEqual([[false], [true]]);
    await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());
    off();
    expect(remove).toHaveBeenCalledTimes(1);
    listeners.networkStatusChange({ connected: false });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not call a connection that is merely not validated offline', async () => {
    // Android reports connected=false for a few seconds after a switch, and for
    // good on a network that blocks its reachability probe.
    const net = createCapacitorNetwork();
    plugin.getStatus.mockResolvedValueOnce({ connected: false, connectionType: 'wifi' });
    expect(await net.isOnline()).toBe(true);
    plugin.getStatus.mockResolvedValueOnce({ connected: false, connectionType: 'cellular' });
    expect(await net.isOnline()).toBe(true);
    plugin.getStatus.mockResolvedValueOnce({ connected: false, connectionType: 'none' });
    expect(await net.isOnline()).toBe(false);
    // An older plugin with no connection type: the flag is all there is.
    plugin.getStatus.mockResolvedValueOnce({ connected: false });
    expect(await net.isOnline()).toBe(false);

    const fn = vi.fn();
    const off = net.onChange(fn);
    await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());
    listeners.networkStatusChange({ connected: false, connectionType: 'wifi' });
    expect(fn.mock.calls).toEqual([[true]]);
    off();
  });

  describe('looking again after a "not connected" event', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('corrects itself ~500ms later when the switch has finished and no further event came', async () => {
      const net = createCapacitorNetwork();
      const fn = vi.fn();
      const off = net.onChange(fn);
      await vi.advanceTimersByTimeAsync(0);
      listeners.networkStatusChange({ connected: false, connectionType: 'none' });
      expect(fn.mock.calls).toEqual([[false]]);
      plugin.getStatus.mockResolvedValueOnce({ connected: true, connectionType: 'wifi' });
      await vi.advanceTimersByTimeAsync(499);
      expect(plugin.getStatus).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(plugin.getStatus).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls).toEqual([[false], [true]]);
      off();
    });

    it('does not look again after a connected event, a newer event, or unsubscribing', async () => {
      const net = createCapacitorNetwork();
      const off = net.onChange(vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      listeners.networkStatusChange({ connected: true, connectionType: 'wifi' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(plugin.getStatus).not.toHaveBeenCalled();
      listeners.networkStatusChange({ connected: false, connectionType: 'none' });
      listeners.networkStatusChange({ connected: true, connectionType: 'wifi' }); // supersedes it
      await vi.advanceTimersByTimeAsync(1_000);
      expect(plugin.getStatus).not.toHaveBeenCalled();
      listeners.networkStatusChange({ connected: false, connectionType: 'none' });
      off();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(plugin.getStatus).not.toHaveBeenCalled();
    });
  });

  it('unsubscribing before the native side answers still removes the listener', async () => {
    const net = createCapacitorNetwork();
    net.onChange(vi.fn())();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });

  it('never throws when the plugin is missing', () => {
    plugin.addListener.mockImplementationOnce(() => {
      throw new Error('not implemented');
    });
    expect(() => createCapacitorNetwork().onChange(vi.fn())()).not.toThrow();
  });
});
