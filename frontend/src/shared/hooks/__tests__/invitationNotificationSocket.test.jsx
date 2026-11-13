/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';

/**
 * An invitation event arrives beside the invite's own `notification:new`,
 * which already writes the row in and is followed by the pushed unread count.
 * So the invitation handlers mark the notification lists out of date without
 * refetching them, and leave the count alone (FEP-2, FEP-3).
 */
const store = vi.hoisted(() => ({ socket: null, isConnected: false }));
const idb = vi.hoisted(() => ({ idbSet: vi.fn(async () => {}) }));

vi.mock('../../lib/idb', () => ({
  idbEpoch: () => 3,
  bumpIdbEpoch: () => {},
  idbGet: async () => null,
  idbSet: (...a) => idb.idbSet(...a),
  idbDelete: async () => {},
}));

vi.mock('../../stores/useGlobalSocketStore', () => ({
  useGlobalSocketStore: Object.assign((sel) => sel(store), { getState: () => store }),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me', username: 'me' } }) }));
vi.mock('../useMessages', () => ({ useConversations: () => ({ conversations: [] }) }));
vi.mock('../../../features/messages/shared/utils/outboxClient', () => ({ bindOutbox: vi.fn(), noteSocketConnected: vi.fn(), wakeOutbox: vi.fn(async () => {}), outbox: { flush: vi.fn(async () => {}) } }));

const { useGlobalSocketSync } = await import('../useGlobalSocketSync');

let handlers;
let qc;
let fetches;

function mount() {
  handlers = {};
  store.socket = {
    connected: true,
    on: vi.fn((event, fn) => { handlers[event] = fn; }),
    off: vi.fn(),
    emit: vi.fn(),
    timeout: () => ({ emit: () => {} }),
  };
  store.isConnected = true;
  qc = new QueryClient();
  fetches = vi.fn(async () => ({ count: 9 }));
  qc.setQueryData(['notifications'], { pages: [{ data: [] }], pageParams: [undefined] });
  qc.setQueryData(['notifications', 'unreadCount'], { count: 2 });
  // The count is on screen (the bell): an invalidation of it would refetch.
  new QueryObserver(qc, { queryKey: ['notifications', 'unreadCount'], queryFn: fetches, staleTime: Infinity })
    .subscribe(() => {});
  renderHook(() => useGlobalSocketSync(), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  mount();
});

describe('invitation events', () => {
  it.each([
    ['domainEvent invitation:new', () => handlers.domainEvent({ type: 'invitation:new', data: {} })],
    ['domainEvent invitation:updated', () => handlers.domainEvent({ type: 'invitation:updated', data: {} })],
    ['direct invitation:new', () => handlers['invitation:new']({})],
    ['direct invitation:updated', () => handlers['invitation:updated']({})],
  ])('%s marks the lists stale and leaves the pushed count', async (_name, fire) => {
    act(() => fire());
    await new Promise((r) => setTimeout(r, 10));
    expect(qc.getQueryState(['notifications'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['notifications', 'unreadCount'])?.isInvalidated).toBe(false);
    expect(fetches).not.toHaveBeenCalled();
  });
});
