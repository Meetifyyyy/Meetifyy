/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@shared/utils/toast', () => ({ showToast }));

import { createOutbox } from '../outbox';
import { isOnline } from '@shared/lib/networkStatus';
import { blockIfOffline } from '@shared/lib/offlineGuard';

/**
 * Messages are the one thing that IS queued offline (creates are refused, see
 * lib/offlineGuard). Making creates refuse must not change that: a message sent
 * with no network is stored, stays pending, is never blocked or toasted by the
 * offline guard, and goes out exactly once when the connection returns.
 */
let onLine;
beforeEach(() => {
  onLine = false;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  showToast.mockReset();
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const rows = new Map();
  let clock = 1_000_000;
  let timer = null;
  const sentIds = [];
  const store = {
    put: vi.fn(async (e) => { rows.set(e.clientId, { ...e }); return true; }),
    delete: vi.fn(async (id) => { rows.delete(id); }),
    all: vi.fn(async (userId) => [...rows.values()].filter((e) => e.userId === userId)),
  };
  // The transport, as the chat sends it: no network means "offline", not a failure.
  const send = vi.fn(async (entry) => {
    if (!isOnline()) return { ok: false, offline: true };
    sentIds.push(entry.clientId);
    return { ok: true, message: { id: `srv-${entry.clientId}` } };
  });
  const onSent = vi.fn();
  const onFailed = vi.fn();
  const outbox = createOutbox({
    store, send, onSent, onFailed,
    getUserId: () => 'u1',
    now: () => clock,
    setTimer: (fn, ms) => { timer = { fn, at: clock + ms }; return timer; },
    clearTimer: () => { timer = null; },
  });
  const advance = async (ms) => {
    clock += ms;
    if (timer && timer.at <= clock) { const { fn } = timer; timer = null; fn(); }
    await outbox.flush();
  };
  const entry = (clientId) => ({ clientId, userId: 'u1', conversationId: 'c1', payload: { text: clientId }, createdAt: clock++ });
  return { outbox, rows, sentIds, send, onSent, onFailed, advance, entry };
}

describe('chat outbox while offline', () => {
  it('queues a message sent offline, keeps it pending, and delivers it once on reconnect', async () => {
    const h = setup();
    const e = h.entry('m1');
    expect((await h.outbox.enqueue(e)).sendNow).toBe(true);
    // The direct send found no network; the outbox keeps it for later.
    await h.outbox.complete(e, 'offline');
    expect(h.rows.has('m1')).toBe(true);

    await h.advance(60_000);
    expect(h.sentIds).toEqual([]);
    expect(h.onFailed).not.toHaveBeenCalled();

    onLine = true;
    await h.advance(60_000);
    await h.advance(60_000);
    expect(h.sentIds).toEqual(['m1']);
    expect(h.rows.has('m1')).toBe(false);
  });

  it('is not subject to the create guard: nothing refuses or announces a message', async () => {
    const h = setup();
    await h.outbox.enqueue(h.entry('m1'));
    expect(showToast).not.toHaveBeenCalled();
    // While a post / comment / activity is refused with a message at this moment.
    expect(blockIfOffline('post')).toBe(true);
    expect(h.rows.has('m1')).toBe(true);
  });
});
