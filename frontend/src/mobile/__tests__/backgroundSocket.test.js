import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installBackgroundSocket, BACKGROUND_GRACE_MS } from '../backgroundSocket';

const fakeDoc = () => {
  const listeners = new Set();
  return {
    visibilityState: 'visible',
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    set(state) { this.visibilityState = state; listeners.forEach((fn) => fn()); },
  };
};
const fakeSocket = () => {
  const s = { connected: true };
  s.disconnect = vi.fn(() => { s.connected = false; });
  s.connect = vi.fn(() => { s.connected = true; });
  return s;
};

describe('background socket release', () => {
  let doc;
  let state;
  const store = { getState: () => state };

  beforeEach(() => {
    vi.useFakeTimers();
    doc = fakeDoc();
    state = { socket: fakeSocket() };
    installBackgroundSocket({ doc, store });
  });

  it('keeps the connection through a short trip away', () => {
    doc.set('hidden');
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS - 1);
    doc.set('visible');
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS);
    expect(state.socket.disconnect).not.toHaveBeenCalled();
  });

  it('releases it after the grace period and reconnects on return', () => {
    doc.set('hidden');
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS);
    expect(state.socket.disconnect).toHaveBeenCalledTimes(1);

    doc.set('visible');
    expect(state.socket.connect).toHaveBeenCalledTimes(1);
  });

  it('does not revive a socket that a sign-out replaced meanwhile', () => {
    doc.set('hidden');
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS);
    const released = state.socket;
    state = { socket: null }; // signed out while away

    doc.set('visible');
    expect(released.connect).not.toHaveBeenCalled();
  });
});
