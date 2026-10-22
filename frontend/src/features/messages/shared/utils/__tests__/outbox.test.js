import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createOutbox,
  classifySendFailure,
  retryDelay,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_FAILED_KEEP_MS,
} from '../outbox';

/**
 * The outbox re-sends what did not land, and nothing else.
 *
 * Auto-resend was removed once because its queue had no owner (it could send
 * as the next account), retried forever, and retried refusals. These pin the
 * rules that make it safe to bring back.
 */
function harness({ user = 'u1', replies = [] } = {}) {
  const rows = new Map();
  const store = {
    put: vi.fn(async (entry) => { rows.set(entry.clientId, { ...entry }); }),
    delete: vi.fn(async (id) => { rows.delete(id); }),
    all: vi.fn(async (userId) =>
      [...rows.values()].filter((e) => e.userId === userId).sort((a, b) => a.createdAt - b.createdAt)),
  };
  let clock = 1_000_000;
  let timer = null;
  const sent = [];
  const queue = [...replies];
  const send = vi.fn(async (entry) => {
    sent.push(entry.clientId);
    return queue.length ? queue.shift() : { ok: true, message: { id: `srv-${entry.clientId}` } };
  });
  const onSent = vi.fn();
  const onFailed = vi.fn();
  const state = { user };
  const outbox = createOutbox({
    store,
    send,
    onSent,
    onFailed,
    getUserId: () => state.user,
    now: () => clock,
    setTimer: (fn, ms) => { timer = { fn, at: clock + ms }; return timer; },
    clearTimer: () => { timer = null; },
  });
  const advance = async (ms) => {
    clock += ms;
    if (timer && timer.at <= clock) {
      const { fn } = timer;
      timer = null;
      fn();
    }
    await outbox.flush();
  };
  const entry = (clientId, conversationId = 'c1', extra = {}) =>
    ({ clientId, userId: state.user, conversationId, payload: { text: clientId }, createdAt: clock++, ...extra });
  return { outbox, store, rows, send, sent, onSent, onFailed, advance, entry, state, queue, now: () => clock };
}

describe('classifySendFailure', () => {
  it('retries everything except an explicit refusal', () => {
    expect(classifySendFailure({ status: 'error', code: 'REJECTED' })).toBe('rejected');
    expect(classifySendFailure({ status: 403 })).toBe('rejected');
    expect(classifySendFailure({ status: 400 })).toBe('rejected');
    expect(classifySendFailure({ status: 'error', code: 'RATE_LIMITED' })).toBe('transient');
    expect(classifySendFailure({ status: 429 })).toBe('transient');
    expect(classifySendFailure({ status: 408 })).toBe('transient');
    expect(classifySendFailure({ status: 503 })).toBe('transient');
    expect(classifySendFailure({ status: 'error', error: 'x' })).toBe('transient'); // older server, no code
    expect(classifySendFailure(null)).toBe('transient'); // no ack
    expect(classifySendFailure(new TypeError('Failed to fetch'))).toBe('transient');
  });

  it('backs off from 2s, doubling, capped at 5 minutes', () => {
    expect(retryDelay(1)).toBe(2_000);
    expect(retryDelay(2)).toBe(4_000);
    expect(retryDelay(20)).toBe(5 * 60_000);
  });
});

describe('outbox', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('lets the first send go out directly and forgets it once confirmed', async () => {
    const e = h.entry('m1');
    expect(await h.outbox.enqueue(e)).toBe(true);
    expect(h.rows.has('m1')).toBe(true); // recorded before it goes out
    await h.outbox.complete(e, 'ok', { id: 'srv-m1' });
    expect(h.rows.has('m1')).toBe(false);
    // The chat screen showed it already; the outbox does not notify again.
    expect(h.onSent).not.toHaveBeenCalled();
  });

  it('retries a send cut off by the connection, with backoff, until it lands', async () => {
    const e = h.entry('m1');
    await h.outbox.enqueue(e);
    await h.outbox.complete(e, 'transient', null);
    expect(h.rows.get('m1').attempts).toBe(1);
    await h.advance(1_000); // not due yet
    expect(h.send).not.toHaveBeenCalled();
    await h.advance(1_500);
    expect(h.sent).toEqual(['m1']);
    expect(h.onSent).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'm1' }), { id: 'srv-m1' });
    expect(h.rows.has('m1')).toBe(false);
  });

  it('never retries a refusal, and keeps it for tap-to-retry', async () => {
    const e = h.entry('m1');
    await h.outbox.enqueue(e);
    await h.outbox.complete(e, 'rejected', { code: 'REJECTED' });
    await h.advance(60 * 60_000);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rows.get('m1').failed).toBe(true);
  });

  it('gives up after the attempt limit and tells the screen', async () => {
    h = harness({ replies: Array.from({ length: 20 }, () => ({ ok: false, failure: null })) });
    await h.store.put(h.entry('m1'));
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i += 1) await h.advance(10 * 60_000);
    expect(h.send).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS);
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    expect(h.rows.get('m1').failed).toBe(true);
  });

  it('gives up on a message older than the age limit', async () => {
    h = harness({ replies: [{ ok: false, failure: null }] });
    await h.store.put(h.entry('m1', 'c1', { createdAt: h.now() - OUTBOX_MAX_AGE_MS - 1 }));
    await h.outbox.flush();
    expect(h.onFailed).toHaveBeenCalledTimes(1);
  });

  it('counts nothing while offline, so a day without signal loses no attempts', async () => {
    h = harness({ replies: Array.from({ length: 50 }, () => ({ ok: false, offline: true })) });
    await h.store.put(h.entry('m1'));
    for (let i = 0; i < 30; i += 1) await h.advance(60 * 60_000);
    expect(h.rows.get('m1').attempts ?? 0).toBe(0);
    expect(h.onFailed).not.toHaveBeenCalled();
  });

  it('keeps a conversation in order: a newer message waits for an older pending one', async () => {
    const older = h.entry('m1');
    await h.outbox.enqueue(older);
    await h.outbox.complete(older, 'transient', null);
    const newer = h.entry('m2');
    expect(await h.outbox.enqueue(newer)).toBe(false); // must not overtake
    await h.advance(3_000);
    expect(h.sent).toEqual(['m1', 'm2']);
  });

  it('does not hold up other conversations, nor a chat behind a refused message', async () => {
    h = harness({ replies: [{ ok: false, failure: { code: 'REJECTED' } }] });
    await h.store.put(h.entry('m1', 'c1'));
    await h.store.put(h.entry('m2', 'c1'));
    await h.store.put(h.entry('m3', 'c2'));
    await h.outbox.flush();
    expect(h.sent).toEqual(['m1', 'm2', 'm3']);
    expect(h.rows.get('m1').failed).toBe(true);
  });

  it('only ever sends the signed-in account’s messages', async () => {
    await h.store.put({ ...h.entry('theirs'), userId: 'u2' });
    await h.store.put(h.entry('mine'));
    await h.outbox.flush();
    expect(h.sent).toEqual(['mine']);
    h.state.user = null; // signed out
    await h.store.put(h.entry('later'));
    await h.outbox.flush();
    expect(h.sent).toEqual(['mine']);
  });

  it('never sends one message twice when flushes overlap', async () => {
    await h.store.put(h.entry('m1'));
    await Promise.all([h.outbox.flush(), h.outbox.flush(), h.outbox.flush()]);
    expect(h.sent).toEqual(['m1']);
  });

  it('skips a message the chat screen is sending right now', async () => {
    const e = h.entry('m1');
    await h.outbox.enqueue(e); // in flight on the direct path
    await h.outbox.flush();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('sends a failed message again on tap-to-retry', async () => {
    await h.store.put({ ...h.entry('m1'), failed: true, failedAt: h.now(), attempts: OUTBOX_MAX_ATTEMPTS });
    expect(await h.outbox.retry('m1')).toBe(true);
    expect(h.sent).toEqual(['m1']);
    expect(h.rows.has('m1')).toBe(false);
    expect(await h.outbox.retry('unknown')).toBe(false);
  });

  it('forgets failed messages nobody retried within a week', async () => {
    await h.store.put({ ...h.entry('m1'), failed: true, failedAt: h.now() - OUTBOX_FAILED_KEEP_MS - 1 });
    await h.outbox.flush();
    expect(h.rows.has('m1')).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });
});
