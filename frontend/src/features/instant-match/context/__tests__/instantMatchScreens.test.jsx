/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Instant Match open on two tabs or devices (IM-19, docs/private/
 * backend-optimization/E7_INSTANT_MATCH_INSPECTION.md): accepting on one moves
 * the others to the wait, and only a request actually sent reads as one.
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
    respondToMatch: vi.fn(async () => ({ ok: true })),
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

const { InstantMatchProvider, useInstantMatch, isRequestSent } = await import('../InstantMatchContext');

let ctx;
let qc;
let visibility = 'visible';
function Probe() {
  ctx = useInstantMatch();
  return null;
}

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

const card = { matchId: 'm1', candidate: { id: 'x', username: 'x' }, activity: 'study', expiresAt: Date.now() + 30_000 };

describe('accepting on another screen (IM-19)', () => {
  it('moves this screen from the card that asks to the wait', async () => {
    await flush();
    act(() => socket.fire('match:found', card));
    expect(ctx.status).toBe('match_found');

    act(() => socket.fire('match:waiting', { matchId: 'm1' }));
    expect(ctx.status).toBe('waiting');
    expect(isRequestSent(ctx.activeMatch)).toBe(false);
  });

  it('ignores a wait for a match this screen is not showing', async () => {
    await flush();
    act(() => socket.fire('match:found', card));
    act(() => socket.fire('match:waiting', { matchId: 'other' }));
    expect(ctx.status).toBe('match_found');
  });

  it('cannot pass from the wait on a match it accepted elsewhere', async () => {
    await flush();
    act(() => socket.fire('match:found', card));
    act(() => socket.fire('match:waiting', { matchId: 'm1' }));
    socket.respondToMatch.mockClear();
    await act(async () => { await ctx.respondToMatch('decline'); });
    expect(socket.respondToMatch).not.toHaveBeenCalled();
  });

  it('still lets the sender withdraw a request', async () => {
    await flush();
    act(() => socket.fire('match:found', { ...card, awaitingOther: true, requestSent: true }));
    expect(ctx.status).toBe('waiting');
    socket.respondToMatch.mockClear();
    await act(async () => { await ctx.respondToMatch('decline'); });
    expect(socket.respondToMatch).toHaveBeenCalledWith('m1', 'decline');
  });
});

describe('isRequestSent', () => {
  it('reads requestSent, and falls back to awaitingOther from an older server', () => {
    expect(isRequestSent({ requestSent: true })).toBe(true);
    expect(isRequestSent({ requestSent: false, awaitingOther: true })).toBe(false);
    expect(isRequestSent({ awaitingOther: true })).toBe(true);
    expect(isRequestSent({})).toBe(false);
    expect(isRequestSent(null)).toBe(false);
  });
});
