import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createOutbox,
  classifySendFailure,
  isNetworkFailure,
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
function harness({ user = 'u1', replies = [], sendTimeoutMs } = {}) {
  const state = { user, generation: 0, storageFull: false };
  const rows = new Map();
  const store = {
    put: vi.fn(async (entry) => {
      if (state.storageFull) return false;
      rows.set(entry.clientId, { ...entry });
      return true;
    }),
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
  const outbox = createOutbox({
    store,
    send,
    onSent,
    onFailed,
    getUserId: () => state.user,
    getGeneration: () => state.generation,
    sendTimeoutMs,
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
  /** Records an entry and waits for the flush that enqueue kicks off. */
  const submit = async (e, epoch) => {
    const res = await outbox.enqueue(e, epoch);
    await outbox.flush();
    return res;
  };
  return {
    outbox, store, rows, send, sent, onSent, onFailed, advance, entry, submit, state, queue,
    now: () => clock, hasTimer: () => timer !== null,
  };
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

  it('records a send before it goes out, sends it once through the flush, and forgets it once confirmed', async () => {
    const e = h.entry('m1');
    let storedWhenSent = false;
    h.send.mockImplementationOnce(async (entry) => {
      storedWhenSent = h.rows.has(entry.clientId); // recorded before it goes out
      h.sent.push(entry.clientId);
      return { ok: true, message: { id: 'srv-m1' } };
    });
    expect(await h.outbox.enqueue(e)).toEqual({ persisted: true, settled: false });
    await h.outbox.flush();
    expect(storedWhenSent).toBe(true);
    expect(h.sent).toEqual(['m1']);
    expect(h.rows.has('m1')).toBe(false);
    expect(h.onSent).toHaveBeenCalledTimes(1);
    expect(h.onSent).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'm1' }), { id: 'srv-m1' }, 0);
    // Nothing is left to send: more flushes do not send it again.
    await h.outbox.flush();
    await h.advance(60 * 60_000);
    expect(h.sent).toEqual(['m1']);
  });

  it('retries a send cut off by the connection, with backoff, until it lands', async () => {
    h = harness({ replies: [{ ok: false, failure: null }] });
    await h.submit(h.entry('m1'));
    expect(h.sent).toEqual(['m1']);
    expect(h.rows.get('m1').attempts).toBe(1);
    expect(h.onFailed).not.toHaveBeenCalled(); // still "Sending…"
    await h.advance(1_000); // not due yet
    expect(h.sent).toEqual(['m1']);
    await h.advance(1_500);
    expect(h.sent).toEqual(['m1', 'm1']);
    expect(h.onSent).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'm1' }), { id: 'srv-m1' }, 0);
    expect(h.rows.has('m1')).toBe(false);
  });

  it('never retries a refusal, and keeps it for tap-to-retry', async () => {
    h = harness({ replies: [{ ok: false, failure: { code: 'REJECTED' } }] });
    await h.submit(h.entry('m1'));
    await h.advance(60 * 60_000);
    expect(h.sent).toEqual(['m1']);
    expect(h.rows.get('m1').failed).toBe(true);
    expect(h.onFailed).toHaveBeenCalledTimes(1);
  });

  it('treats a REST 4xx like a socket refusal, and a 5xx as worth retrying', async () => {
    h = harness({ replies: [{ ok: false, failure: Object.assign(new Error('forbidden'), { status: 403 }) }] });
    await h.submit(h.entry('m1'));
    expect(h.rows.get('m1').failed).toBe(true);
    h = harness({ replies: [{ ok: false, failure: Object.assign(new Error('boom'), { status: 503 }) }] });
    await h.submit(h.entry('m1'));
    expect(h.rows.get('m1').failed).toBeUndefined();
    expect(h.rows.get('m1').attempts).toBe(1);
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
    h = harness({ replies: [{ ok: false, failure: null }] });
    await h.submit(h.entry('m1')); // fails, backs off
    await h.submit(h.entry('m2')); // must not overtake it
    expect(h.sent).toEqual(['m1']);
    await h.advance(3_000);
    expect(h.sent).toEqual(['m1', 'm1', 'm2']);
  });

  it('sends messages written back to back in the order they were written', async () => {
    await Promise.all([h.outbox.enqueue(h.entry('m1')), h.outbox.enqueue(h.entry('m2')), h.outbox.enqueue(h.entry('m3'))]);
    await h.outbox.flush();
    expect(h.sent).toEqual(['m1', 'm2', 'm3']);
    expect(h.onSent).toHaveBeenCalledTimes(3);
  });

  it('sends a message written while another send is still waiting for its ack, once each', async () => {
    let releaseFirst;
    h.send.mockImplementationOnce((entry) => new Promise((r) => {
      h.sent.push(entry.clientId);
      releaseFirst = () => r({ ok: true, message: { id: `srv-${entry.clientId}` } });
    }));
    await h.outbox.enqueue(h.entry('m1'));
    while (!releaseFirst) await new Promise((r) => setTimeout(r, 0));
    await h.outbox.enqueue(h.entry('m2')); // flush asked for during a run
    expect(h.sent).toEqual(['m1']); // m1's ack is pending: m2 waits behind it
    releaseFirst();
    await h.outbox.flush();
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

  it('sends a failed message again on tap-to-retry', async () => {
    await h.store.put({ ...h.entry('m1'), failed: true, failedAt: h.now(), attempts: OUTBOX_MAX_ATTEMPTS });
    expect(await h.outbox.retry('m1')).toBe(true);
    expect(h.sent).toEqual(['m1']);
    expect(h.rows.has('m1')).toBe(false);
    expect(await h.outbox.retry('unknown')).toBe(false);
  });

  it('a tap-to-retry that races a sign-out sends nothing and passes the generation to storage', async () => {
    await h.store.put({ ...h.entry('m1'), failed: true, failedAt: h.now(), attempts: OUTBOX_MAX_ATTEMPTS });
    h.store.put.mockImplementationOnce(async (e, generation) => {
      expect(generation).toBe(h.state.generation);
      h.state.generation += 1; // signed out while the write was in flight
      return true;
    });
    expect(await h.outbox.retry('m1')).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('forgets failed messages nobody retried within a week', async () => {
    await h.store.put({ ...h.entry('m1'), failed: true, failedAt: h.now() - OUTBOX_FAILED_KEEP_MS - 1 });
    await h.outbox.flush();
    expect(h.rows.has('m1')).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('outbox after a restart', () => {
  it('does not let a new message overtake an older one still stored from before', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    // Left on disk by the previous run of the app; nothing in memory knows it.
    await h.store.put({ ...h.entry('old'), attempts: 1, nextAttemptAt: 0 });
    await h.submit(h.entry('new'));
    expect(h.sent).toEqual(['old']); // old failed again; new waited behind it
    await h.advance(5_000);
    expect(h.sent).toEqual(['old', 'old', 'new']);
  });
});

describe('outbox safety under sign-out and storage trouble', () => {
  it('writes nothing back when the account signed out while a send was in flight', async () => {
    const h = harness();
    let release;
    h.send.mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: false, failure: null }); }));
    await h.outbox.enqueue(h.entry('m1'), 0);
    while (!release) await new Promise((r) => setTimeout(r, 0));
    h.rows.clear(); // sign-out emptied the store...
    h.state.generation += 1; // ...and bumped the generation
    release();
    await h.outbox.flush();
    expect(h.rows.size).toBe(0);
    expect(h.onFailed).not.toHaveBeenCalled();
  });

  it('stops a flush mid-run when the account changes, so nothing goes out as the next one', async () => {
    let releaseFirst;
    const h = harness();
    h.send.mockImplementationOnce((entry) => new Promise((r) => {
      h.sent.push(entry.clientId);
      releaseFirst = () => r({ ok: true, message: { id: `srv-${entry.clientId}` } });
    }));
    await h.store.put(h.entry('a1', 'c1'));
    await h.store.put(h.entry('a2', 'c2'));
    const run = h.outbox.flush();
    while (!releaseFirst) await new Promise((r) => setTimeout(r, 0));
    h.state.user = 'u2'; // B signed in while a1 was waiting on its ack
    h.state.generation += 1;
    releaseFirst();
    await run;
    expect(h.sent).toEqual(['a1']); // a2 never sent under B
    expect(h.onSent).not.toHaveBeenCalled();
  });

  it('delivers a send storage would not keep once, and tells the screen, so it is never stuck on Sending', async () => {
    const h = harness();
    h.state.storageFull = true;
    const res = await h.outbox.enqueue(h.entry('m1'));
    expect(res).toEqual({ persisted: false, settled: true });
    expect(h.sent).toEqual(['m1']);
    expect(h.onSent).toHaveBeenCalledTimes(1);
    expect(h.onFailed).not.toHaveBeenCalled();
    await h.outbox.flush();
    await h.advance(60 * 60_000);
    expect(h.sent).toEqual(['m1']); // exactly once
  });

  it('shows an unsaved send that fails, or finds no network, as Not delivered: nothing can retry it', async () => {
    let h = harness({ replies: [{ ok: false, failure: null }] });
    h.state.storageFull = true;
    await h.outbox.enqueue(h.entry('m1'));
    // The last attempt's failure travels with it, so the bubble can say why.
    expect(h.onFailed).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'm1' }), undefined, null);
    h = harness({ replies: [{ ok: false, offline: true }] });
    h.state.storageFull = true;
    await h.outbox.enqueue(h.entry('m1'));
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    await h.advance(60 * 60_000);
    expect(h.sent).toEqual(['m1']); // never re-sent
  });

  it('writes nothing and tells nobody about an unsaved send that finished after a sign-out', async () => {
    const h = harness();
    h.state.storageFull = true;
    h.send.mockImplementationOnce(async () => { h.state.generation += 1; return { ok: true, message: { id: 'x' } }; });
    await h.outbox.enqueue(h.entry('m1'), 0);
    expect(h.onSent).not.toHaveBeenCalled();
    expect(h.onFailed).not.toHaveBeenCalled();
  });

  it('holds a newer message back while an unsaved one of the same chat is still out', async () => {
    const h = harness();
    h.state.storageFull = true;
    let release;
    h.send.mockImplementationOnce((entry) => new Promise((r) => {
      h.sent.push(entry.clientId);
      release = () => r({ ok: true, message: { id: 'srv-u' } });
    }));
    const unsaved = h.outbox.enqueue(h.entry('u1'));
    while (!release) await new Promise((r) => setTimeout(r, 0));
    h.state.storageFull = false;
    await h.outbox.enqueue(h.entry('m2')); // stored; its flush must not overtake u1
    await h.outbox.flush();
    expect(h.sent).toEqual(['u1']);
    release();
    await unsaved;
    await h.outbox.flush();
    expect(h.sent).toEqual(['u1', 'm2']);
  });

  it('keeps the earliest retry: a long backoff elsewhere does not delay a short one', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }, { ok: false, failure: null }] });
    await h.store.put(h.entry('a', 'c1'));
    await h.store.put({ ...h.entry('b', 'c2'), attempts: 5 });
    await h.outbox.flush(); // a: retry in 2s, b: retry in 64s
    await h.advance(2_500);
    expect(h.sent).toEqual(['a', 'b', 'a']);
  });

  it('lets the flush send a retried message the outbox never had', async () => {
    const h = harness();
    const res = await h.outbox.enqueue(h.entry('rebuilt'));
    expect(res.persisted).toBe(true);
    await h.outbox.flush();
    expect(h.sent).toEqual(['rebuilt']);
  });

  it('a send that throws is a transient failure, not a stuck conversation', async () => {
    const h = harness();
    h.send.mockRejectedValueOnce(new Error('boom'));
    await h.submit(h.entry('m1'));
    expect(h.rows.get('m1').attempts).toBe(1);
    await h.advance(3_000);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.rows.has('m1')).toBe(false);
  });
});

describe('outbox under storage trouble and chat aliases', () => {
  it('treats an unreadable store as an error to retry, not as nothing to send', async () => {
    const h = harness();
    await h.store.put(h.entry('m1'));
    h.store.all.mockResolvedValueOnce(null); // read failed once
    await h.outbox.flush();
    expect(h.send).not.toHaveBeenCalled();
    await h.advance(31_000); // the error retry
    expect(h.sent).toEqual(['m1']);
  });

  it('does not let an unsaved message overtake an older pending one in its chat', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    await h.submit(h.entry('m1')); // pending, backing off
    h.state.storageFull = true;
    const res = await h.outbox.enqueue(h.entry('m2'));
    expect(res).toEqual({ persisted: false, settled: true });
    expect(h.sent).toEqual(['m1']); // m2 was not sent
    expect(h.onFailed).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'm2' }), undefined);
  });

  it('keeps one order for a chat addressed by two ids', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    await h.submit(h.entry('m1', 'pub-1', { orderKey: 'int-1' })); // fails, backs off
    await h.submit(h.entry('m2', 'int-1', { orderKey: 'int-1' }));
    expect(h.sent).toEqual(['m1']); // m2 waited
  });
});

describe('outbox: a given-up entry does not strand the chat behind it', () => {
  it('sends the next message of the chat in the same run when an entry has just used its last attempt', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    await h.store.put({ ...h.entry('m1'), attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    await h.store.put(h.entry('m2'));
    await h.outbox.flush();
    expect(h.rows.get('m1').failed).toBe(true);
    expect(h.onFailed).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'm1' }), 0, null);
    // m1 is no longer ahead of it: m2 is not left without a timer, waiting for the next connect.
    expect(h.sent).toEqual(['m1', 'm2']);
    expect(h.onSent).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'm2' }), { id: 'srv-m2' }, 0);
  });

  it('still holds the chat behind an entry that is only waiting out a backoff', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    await h.store.put(h.entry('m1'));
    await h.store.put(h.entry('m2'));
    await h.outbox.flush();
    expect(h.sent).toEqual(['m1']);
    expect(h.hasTimer()).toBe(true);
  });
});

describe('outbox: waking up after a connection change', () => {
  it('flush({ now: true }) sends an entry that is waiting out a backoff; a plain flush does not', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    await h.submit(h.entry('m1')); // fails, due again in 2s
    await h.outbox.flush();
    expect(h.sent).toEqual(['m1']);
    await h.outbox.flush({ now: true });
    expect(h.sent).toEqual(['m1', 'm1']);
    expect(h.rows.has('m1')).toBe(false);
  });

  it('a wake-up asked for during a run gets its own pass without the backoff', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    await h.submit(h.entry('m1')); // backing off
    let release;
    h.send.mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: false, failure: null }); }));
    h.store.put.mockClear();
    await h.store.put(h.entry('other', 'c2'));
    const running = h.outbox.flush();
    while (!release) await new Promise((r) => setTimeout(r, 0));
    void h.outbox.flush({ now: true });
    release();
    await running;
    await h.outbox.flush();
    expect(h.sent.filter((id) => id === 'm1')).toHaveLength(2);
  });

  it('counts the attempt and backs off again when the woken send fails', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }, { ok: false, failure: null }] });
    await h.submit(h.entry('m1'));
    await h.outbox.flush({ now: true });
    expect(h.rows.get('m1').attempts).toBe(2);
    expect(h.rows.get('m1').nextAttemptAt).toBeGreaterThan(h.now());
  });
});

describe('outbox: a send that never settles', () => {
  it('is cut off by the watchdog as a transient failure, so the outbox is not blocked for ever', async () => {
    const h = harness({ sendTimeoutMs: 20 });
    h.send.mockImplementationOnce(() => new Promise(() => {}));
    await h.submit(h.entry('m1'));
    expect(h.rows.get('m1').attempts).toBe(1);
    expect(h.onFailed).not.toHaveBeenCalled();
    // Flushing is clear again: a later flush runs, and sends it.
    await h.advance(3_000);
    expect(h.sent).toContain('m1');
    expect(h.rows.has('m1')).toBe(false);
  });

  it('applies to a send storage would not keep, which is reported failed instead of hanging', async () => {
    const h = harness({ sendTimeoutMs: 20 });
    h.state.storageFull = true;
    h.send.mockImplementationOnce(() => new Promise(() => {}));
    const res = await h.outbox.enqueue(h.entry('m1'));
    expect(res).toEqual({ persisted: false, settled: true });
    expect(h.onFailed).toHaveBeenCalledTimes(1);
  });

  it('a send that throws before it returns a promise is a failed attempt too', async () => {
    const h = harness();
    h.send.mockImplementationOnce(() => { throw new Error('sync boom'); });
    await h.submit(h.entry('m1'));
    expect(h.rows.get('m1').attempts).toBe(1);
  });
});

describe('outbox: a network failure ends the run', () => {
  it('does not try the other chats when a send never reached the server', async () => {
    const h = harness({ replies: [{ ok: false, failure: new TypeError('Failed to fetch') }] });
    await h.store.put(h.entry('a', 'c1'));
    await h.store.put(h.entry('b', 'c2'));
    await h.store.put(h.entry('c', 'c3'));
    await h.outbox.flush();
    expect(h.sent).toEqual(['a']);
    expect(h.hasTimer()).toBe(true); // it comes back by itself
    await h.advance(3_000);
    expect(h.sent).toEqual(['a', 'a', 'b', 'c']);
  });

  it('still tries the other chats after a failure that came back from the server', async () => {
    const h = harness({ replies: [{ ok: false, failure: Object.assign(new Error('boom'), { status: 503 }) }] });
    await h.store.put(h.entry('a', 'c1'));
    await h.store.put(h.entry('b', 'c2'));
    await h.outbox.flush();
    expect(h.sent).toEqual(['a', 'b']);
  });

  it('comes back after an entry that gave up on a network failure, for the ones it never tried', async () => {
    const h = harness({ replies: [{ ok: false, failure: new TypeError('Failed to fetch') }] });
    await h.store.put({ ...h.entry('a', 'c1'), attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    await h.store.put(h.entry('b', 'c2'));
    await h.outbox.flush();
    expect(h.rows.get('a').failed).toBe(true);
    expect(h.sent).toEqual(['a']);
    expect(h.hasTimer()).toBe(true);
    await h.advance(3_000);
    expect(h.sent).toEqual(['a', 'b']);
  });

  it('knows a network failure from an answer', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new Error('send timed out'))).toBe(true);
    expect(isNetworkFailure(Object.assign(new Error('x'), { status: 503 }))).toBe(false);
    expect(isNetworkFailure({ status: 'error', code: 'RATE_LIMITED' })).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});

describe('outbox: tap-to-retry that storage would not keep', () => {
  it('reports it was not revived, so the screen delivers it once instead', async () => {
    const h = harness();
    await h.store.put({ ...h.entry('m1'), failed: true, failedAt: h.now(), attempts: OUTBOX_MAX_ATTEMPTS });
    h.store.put.mockResolvedValueOnce(false);
    expect(await h.outbox.retry('m1')).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('outbox: the screen is told before the row goes', () => {
  it('calls onSent while the row still exists, so a kill in between leaves a sent message', async () => {
    const h = harness();
    let rowAtOnSent;
    h.onSent.mockImplementationOnce((e) => { rowAtOnSent = h.rows.has(e.clientId); });
    await h.submit(h.entry('m1'));
    expect(rowAtOnSent).toBe(true);
    expect(h.rows.has('m1')).toBe(false);
  });

  it('tells nobody when the account signed out before the confirmation', async () => {
    const h = harness();
    h.send.mockImplementationOnce(async () => {
      h.state.generation += 1; // signed out: the local caches are emptied
      h.rows.clear();
      return { ok: true, message: { id: 'srv' } };
    });
    await h.submit(h.entry('m1'), 0);
    expect(h.onSent).not.toHaveBeenCalled();
  });
});

describe('outbox: storage trouble while backing off', () => {
  it('still reaches "failed" when the store would not keep the attempt count', async () => {
    const h = harness({ replies: Array.from({ length: 30 }, () => ({ ok: false, failure: null })) });
    await h.store.put(h.entry('m1'));
    h.state.storageFull = true; // every later write is refused
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i += 1) await h.advance(10 * 60_000);
    expect(h.send).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS);
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    // Not left as a live entry that would be sent again behind "Not delivered".
    expect(h.rows.has('m1')).toBe(false);
  });

  it('keeps backing off in memory when the store did not keep the delay', async () => {
    const h = harness({ replies: [{ ok: false, failure: null }] });
    await h.store.put(h.entry('m1'));
    h.state.storageFull = true;
    await h.outbox.flush();
    await h.outbox.flush(); // a connect, say: not due yet
    expect(h.sent).toEqual(['m1']);
    await h.advance(3_000);
    expect(h.sent).toEqual(['m1', 'm1']);
  });

  it('does not re-arm a retry timer for ever when storage is unreadable and nothing is known to be pending', async () => {
    const h = harness();
    h.store.all.mockRejectedValue(new Error('IndexedDB unavailable'));
    await h.outbox.flush();
    expect(h.hasTimer()).toBe(false);
  });

  it('does retry on a timer when an entry is known to be pending', async () => {
    const h = harness();
    h.store.all.mockRejectedValue(new Error('IndexedDB unavailable'));
    await h.outbox.enqueue(h.entry('m1')); // tracked: something is waiting
    await h.outbox.flush();
    expect(h.hasTimer()).toBe(true);
  });
});
