/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Reconnect catch-up recovers every missed message, and never loses a window.
 *
 * Before: one request, at most 100 messages, and the sync point then moved to
 * this device's clock whatever the answer — so a long absence lost everything
 * past 100, and an error or a rate-limit refusal lost the whole window.
 */
const store = vi.hoisted(() => ({ socket: null, isConnected: false }));

vi.mock('../../stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: Object.assign((sel) => sel(store), { getState: () => store }),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('../useMessages', () => ({ useConversations: () => ({ conversations: [] }) }));
vi.mock('../../../features/messages/shared/utils/offlineSync', () => ({ flushPendingQueue: vi.fn() }));

const { useGlobalSocketSync, LAST_SYNC_KEY } = await import('../useGlobalSocketSync');

/** A socket whose `message:catchup` answers from a scripted list of replies. */
function fakeSocket(replies) {
  const calls = [];
  const socket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    timeout: () => ({
      emit: (event, payload, ack) => {
        if (event !== 'message:catchup') return;
        calls.push(payload);
        const reply = replies.shift();
        queueMicrotask(() => (reply instanceof Error ? ack(reply) : ack(null, reply)));
      },
    }),
  };
  return { socket, calls };
}

const msg = (id) => ({ id, conversationId: 'c1', text: id });

function mount(socket) {
  store.socket = socket;
  store.isConnected = true;
  const qc = new QueryClient();
  qc.setQueryData(['messages', 'c1'], { pages: [{ messages: [] }], pageParams: [undefined] });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  renderHook(() => useGlobalSocketSync(), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  return { qc, invalidate };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe('message catch-up on connect', () => {
  it('pages until the server is done and stores the SERVER time', async () => {
    localStorage.setItem(LAST_SYNC_KEY, '2026-10-01T00:00:00.000Z');
    const { socket, calls } = fakeSocket([
      { status: 'ok', messages: [msg('m1'), msg('m2')], hasMore: true, cursor: 'c-1', syncedAt: '2026-10-02T09:00:00.000Z' },
      { status: 'ok', messages: [msg('m3')], hasMore: false, cursor: null, syncedAt: '2026-10-02T09:00:01.000Z' },
    ]);
    const { qc } = mount(socket);

    await waitFor(() => expect(localStorage.getItem(LAST_SYNC_KEY)).toBe('2026-10-02T09:00:00.000Z'));
    expect(calls).toEqual([
      { since: '2026-10-01T00:00:00.000Z' },
      { since: '2026-10-01T00:00:00.000Z', after: 'c-1' },
    ]);
    const ids = qc.getQueryData(['messages', 'c1']).pages[0].messages.map((m) => m.id);
    expect(ids.sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps the old sync point when the server refuses', async () => {
    localStorage.setItem(LAST_SYNC_KEY, '2026-10-01T00:00:00.000Z');
    const { socket } = fakeSocket([{ status: 'error', error: 'Too many requests' }]);
    mount(socket);
    await new Promise((r) => setTimeout(r, 20));
    expect(localStorage.getItem(LAST_SYNC_KEY)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('keeps the old sync point when a later page fails', async () => {
    localStorage.setItem(LAST_SYNC_KEY, '2026-10-01T00:00:00.000Z');
    const { socket } = fakeSocket([
      { status: 'ok', messages: [msg('m1')], hasMore: true, cursor: 'c-1', syncedAt: '2026-10-02T09:00:00.000Z' },
      new Error('ack timeout'),
    ]);
    mount(socket);
    await new Promise((r) => setTimeout(r, 20));
    expect(localStorage.getItem(LAST_SYNC_KEY)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('refetches chats from history when the gap is too large to page through', async () => {
    const page = (i) => ({ status: 'ok', messages: [msg(`m${i}`)], hasMore: true, cursor: `c-${i}`, syncedAt: '2026-10-02T09:00:00.000Z' });
    const { socket, calls } = fakeSocket([page(1), page(2), page(3), page(4), page(5), page(6)]);
    const { invalidate } = mount(socket);
    await waitFor(() => expect(localStorage.getItem(LAST_SYNC_KEY)).toBe('2026-10-02T09:00:00.000Z'));
    expect(calls).toHaveLength(5);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages'] });
  });

  it('falls back to this device’s clock only for a server that predates paging', async () => {
    const { socket } = fakeSocket([{ status: 'ok', messages: [] }]);
    mount(socket);
    await waitFor(() => expect(localStorage.getItem(LAST_SYNC_KEY)).not.toBeNull());
    expect(Number.isNaN(Date.parse(localStorage.getItem(LAST_SYNC_KEY)))).toBe(false);
  });
});

describe('message catch-up is never silently dropped', () => {
  it('retries a refused catch-up on its own while still connected', async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(LAST_SYNC_KEY, '2026-10-01T00:00:00.000Z');
      const { socket, calls } = fakeSocket([
        { status: 'error', error: 'Too many requests' },
        { status: 'ok', messages: [msg('m1')], hasMore: false, cursor: null, syncedAt: '2026-10-02T09:00:00.000Z' },
      ]);
      mount(socket);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toHaveLength(1);
      expect(localStorage.getItem(LAST_SYNC_KEY)).toBe('2026-10-01T00:00:00.000Z');
      await vi.advanceTimersByTimeAsync(6_000);
      expect(calls).toHaveLength(2);
      expect(localStorage.getItem(LAST_SYNC_KEY)).toBe('2026-10-02T09:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs again when a connect arrives while one is still in flight', async () => {
    let releaseFirst = () => {};
    const replies = [];
    const calls = [];
    const socket = {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      timeout: () => ({
        emit: (event, payload, ack) => {
          if (event !== 'message:catchup') return;
          calls.push(payload);
          if (calls.length === 1) {
            releaseFirst = () => ack(null, { status: 'ok', messages: [], hasMore: false, cursor: null, syncedAt: 'a' });
          } else {
            queueMicrotask(() => ack(null, replies.shift() ?? { status: 'ok', messages: [], hasMore: false, cursor: null, syncedAt: 'b' }));
          }
        },
      }),
    };
    mount(socket);
    await new Promise((r) => setTimeout(r, 0));
    // The socket's own 'connect' listener fires while the first run waits.
    const onConnect = socket.on.mock.calls.find(([event]) => event === 'connect')[1];
    onConnect();
    expect(calls).toHaveLength(1);
    releaseFirst();
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(localStorage.getItem(LAST_SYNC_KEY)).toBe('b'));
  });
});
