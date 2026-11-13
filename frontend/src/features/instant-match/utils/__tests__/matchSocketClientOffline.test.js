import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * An action asked for while offline (IM-22): it used to wait for the
 * connection with no time limit, so the in-flight guard left start, cancel
 * and respond dead, and a join the person had since abandoned replayed on
 * reconnect and started a search nobody wanted.
 */
const store = vi.hoisted(() => ({ socket: null, subs: new Set() }));
vi.mock('@shared/stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: {
    getState: () => store,
    subscribe: (fn) => {
      store.subs.add(fn);
      return () => store.subs.delete(fn);
    },
  },
}));

const { default: client } = await import('../matchSocketClient');

function fakeSocket() {
  const handlers = {};
  return {
    connected: false,
    emit: vi.fn((event, payload, ack) => ack?.({ status: 'ok' })),
    on: (event, fn) => { handlers[event] = fn; },
    off: () => {},
    connect() {
      this.connected = true;
      handlers.connect?.();
    },
  };
}

let release;
beforeEach(() => {
  vi.useFakeTimers();
  store.socket = fakeSocket();
  release = client.acquire();
});
afterEach(() => {
  release();
  vi.useRealTimers();
});

describe('an action asked for while offline', () => {
  it('gives up after the same 10 s an answer is waited for, and is not replayed later', async () => {
    const join = client.joinQueue({ activity: 'study' });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(join).resolves.toMatchObject({ ok: false, timeout: true });

    store.socket.connect();
    expect(store.socket.emit).not.toHaveBeenCalledWith('queue:join', expect.anything(), expect.anything());
  });

  it('still goes out if the connection comes back in time', async () => {
    const join = client.joinQueue({ activity: 'study' });
    await vi.advanceTimersByTimeAsync(3_000);
    store.socket.connect();
    await expect(join).resolves.toMatchObject({ ok: true });
    expect(store.socket.emit).toHaveBeenCalledWith('queue:join', { activity: 'study' }, expect.any(Function));
    // Its own wait no longer applies once it has been sent.
    await vi.advanceTimersByTimeAsync(20_000);
  });
});
