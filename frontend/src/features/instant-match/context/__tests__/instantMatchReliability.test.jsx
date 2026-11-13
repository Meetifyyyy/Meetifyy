/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';

/**
 * Instant Match on an unreliable phone connection (E-7c, docs/private/
 * backend-optimization/E7_INSTANT_MATCH_INSPECTION.md IM-21, IM-24, IM-25).
 */
const socket = vi.hoisted(() => {
  const handlers = {};
  return {
    handlers,
    connected: true,
    acquire: () => () => {},
    on: (event, cb) => {
      (handlers[event] ||= new Set()).add(cb);
      return () => handlers[event].delete(cb);
    },
    fire: (event, payload) => handlers[event]?.forEach((cb) => cb(payload)),
    sync: vi.fn(),
  };
});
const api = vi.hoisted(() => ({
  getState: vi.fn(async () => ({ state: {}, chat: null })),
  markAsRead: vi.fn(async () => ({})),
}));

vi.mock('../../utils/matchSocketClient', () => ({ default: socket }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', username: 'me', verificationStatus: 'VERIFIED' } }),
}));
vi.mock('@shared/api/apiClient', () => ({
  instantMatchApi: { getState: api.getState },
  messagesApi: { markAsRead: api.markAsRead },
}));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@features/messages/shared/utils/idbMessages', () => ({
  idbDeleteConversationMessages: vi.fn(async () => {}),
}));
// One stable object, as the real hook's state is: a fresh object per render
// would re-run every effect keyed on it.
const chatState = vi.hoisted(() => ({
  chat: { isActive: true, conversationId: 'conv-1', matchId: 'm1', otherUserId: 'them' },
  refresh: async () => null,
  leave: () => {},
  onCountdownElapsed: () => {},
  setChat: () => {},
  dismissEnded: () => {},
  hydrate: () => {},
}));
vi.mock('../../hooks/useInstantMatchChatState', () => ({
  useInstantMatchChatState: () => chatState,
}));
// Every incoming message counts as one the open chat should mark read.
vi.mock('../../utils/unreadRules', () => ({
  evaluateUnread: ({ message, isViewing }) => ({
    count: !isViewing,
    markRead: isViewing,
    messageId: message?.id ?? null,
  }),
}));

const { InstantMatchProvider, useInstantMatch } = await import('../InstantMatchContext');

let ctx;
let qc;
let visibility = 'visible';
function Probe() {
  ctx = useInstantMatch();
  return null;
}
const setVisible = (value) => {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  socket.connected = true;
  socket.sync.mockReset();
  socket.sync.mockImplementation(async () => ({ ok: true, data: { state: {} } }));
  api.markAsRead.mockClear();
  qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <InstantMatchProvider>
        <Probe />
      </InstantMatchProvider>
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () => act(async () => { vi.advanceTimersByTime(0); await Promise.resolve(); });

describe('coming back to the app (IM-21)', () => {
  it('re-reads the match state, once for a burst', async () => {
    await flush();
    const before = socket.sync.mock.calls.length;
    let release;
    socket.sync.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true, data: { state: {} } }); }));

    act(() => { setVisible('hidden'); setVisible('visible'); setVisible('visible'); });
    expect(socket.sync).toHaveBeenCalledTimes(before + 1);
    await act(async () => { release(); });
  });

  it('does not ask while offline', async () => {
    await flush();
    const before = socket.sync.mock.calls.length;
    socket.connected = false;
    act(() => setVisible('visible'));
    expect(socket.sync).toHaveBeenCalledTimes(before);
  });
});

describe('"Time\'s up" (IM-24)', () => {
  it('asks the server if the expiry push never comes', async () => {
    await flush();
    act(() => socket.fire('match:found', { matchId: 'm9', candidate: { id: 'x', username: 'x' }, expiresAt: Date.now() + 30_000 }));
    act(() => ctx.handleMatchTimeout());
    expect(ctx.status).toBe('timed_out');
    const before = socket.sync.mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(11_990); });
    expect(socket.sync).toHaveBeenCalledTimes(before);
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(socket.sync).toHaveBeenCalledTimes(before + 1);
  });
});

describe('read receipts in an open chat (IM-25 / FEF-23)', () => {
  const message = (id) => ({ message: { id, conversationId: 'conv-1', senderId: 'them' } });

  it('one request for a burst, none while hidden, one on coming back', async () => {
    await flush();
    await act(async () => { await ctx.openMatchChat(); });
    await act(async () => { vi.advanceTimersByTime(1_000); });
    api.markAsRead.mockClear();

    act(() => { socket.fire('message:new', message('a')); socket.fire('message:new', message('b')); socket.fire('message:new', message('c')); });
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(api.markAsRead).toHaveBeenCalledTimes(1);
    expect(api.markAsRead).toHaveBeenCalledWith('conv-1');

    act(() => setVisible('hidden'));
    act(() => socket.fire('message:new', message('d')));
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(api.markAsRead).toHaveBeenCalledTimes(1);

    act(() => setVisible('visible'));
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(api.markAsRead).toHaveBeenCalledTimes(2);
  });
});

describe('a match opening its chat (FEF-22)', () => {
  it('refreshes the inbox once', async () => {
    await flush();
    const inbox = vi.fn(async () => []);
    qc.setQueryData(['conversations'], []);
    const unsubscribe = new QueryObserver(qc, { queryKey: ['conversations'], queryFn: inbox, staleTime: Infinity }).subscribe(() => {});

    act(() => socket.fire('match:accepted', {
      matchId: 'm1', chatId: 'pub-1', internalId: 'conv-1', expiresAt: Date.now() + 86_400_000,
      activity: 'study', candidate: { id: 'them', username: 'them' },
    }));
    await act(async () => { vi.advanceTimersByTime(50); });

    expect(inbox).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
