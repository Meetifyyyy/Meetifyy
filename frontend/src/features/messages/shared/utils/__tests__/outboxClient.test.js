/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  socket: null,
  online: true,
  onlineListeners: [],
  rows: new Map(),
  api: {
    messages: { sendMessage: vi.fn() },
    dm: { sendMessage: vi.fn() },
    group: { sendMessage: vi.fn() },
  },
}));

vi.mock('@stores/useGlobalSocketStore', () => ({ useGlobalSocketStore: { getState: () => ({ socket: h.socket }) } }));
vi.mock('@shared/api/apiClient', () => ({ messagesApi: h.api.messages, dmApi: h.api.dm, groupApi: h.api.group }));
vi.mock('@shared/lib/networkStatus', () => ({
  isOnline: () => h.online,
  subscribeOnline: (fn) => { h.onlineListeners.push(fn); return () => {}; },
}));
vi.mock('../idbMessages', () => ({
  idbOutboxAll: vi.fn(async (userId) => [...h.rows.values()].filter((e) => e.userId === userId)),
  idbOutboxDelete: vi.fn(async (id) => { h.rows.delete(id); }),
  idbOutboxPut: vi.fn(async (e) => { h.rows.set(e.clientId, { ...e }); return true; }),
  idbPatchMessage: vi.fn(async () => {}),
  idbDeleteMessage: vi.fn(async () => {}),
  idbSaveMessages: vi.fn(async () => {}),
}));

import { outbox, bindOutbox, sendOutboxEntry, restApiForChatType, noteSocketConnected, wakeOutbox } from '../outboxClient';

/** A socket whose ack behaviour a test scripts: 'ok' | 'timeout' | an ack object. */
function fakeSocket(ack) {
  const emit = vi.fn((event, payload, cb) => {
    if (ack === 'timeout') cb(new Error('operation has timed out'));
    else if (ack === 'ok') cb(null, { status: 'ok', message: { id: `srv-${payload.clientId}` } });
    else cb(null, ack);
  });
  return { connected: true, emit, timeout: vi.fn(() => ({ emit })) };
}

const entry = (over = {}) => ({
  clientId: 'c1', userId: 'u1', conversationId: 'conv', createdAt: Date.now(),
  payload: { clientId: 'c1', conversationId: 'conv', text: 'hi' }, ...over,
});
const restError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(() => {
  h.socket = null;
  h.online = true;
  h.rows.clear();
  Object.values(h.api).forEach((a) => a.sendMessage.mockReset());
  localStorage.setItem('loggedIn', 'true');
  localStorage.setItem('currentUser', JSON.stringify({ id: 'u1' }));
});
afterEach(() => {
  outbox.reset();
  noteSocketConnected(); // a timed-out socket is distrusted for a minute, across tests
  localStorage.clear();
});

describe('sendOutboxEntry', () => {
  it('sends over the socket and does not touch REST when the ack says ok', async () => {
    h.socket = fakeSocket('ok');
    expect(await sendOutboxEntry(entry())).toEqual({ ok: true, message: { id: 'srv-c1' } });
    expect(h.socket.emit).toHaveBeenCalledTimes(1);
    expect(h.api.messages.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to REST when the socket does not ack in time', async () => {
    h.socket = fakeSocket('timeout');
    h.api.messages.sendMessage.mockResolvedValue({ id: 'srv-rest' });
    expect(await sendOutboxEntry(entry())).toEqual({ ok: true, message: { id: 'srv-rest' } });
    expect(h.api.messages.sendMessage).toHaveBeenCalledWith('conv', entry().payload);
  });

  it('reports the REST failure, with its status, when the socket timed out and REST failed', async () => {
    h.socket = fakeSocket('timeout');
    h.api.messages.sendMessage.mockRejectedValue(restError(403));
    const res = await sendOutboxEntry(entry());
    expect(res.ok).toBe(false);
    expect(res.failure.status).toBe(403);
  });

  it('does not try REST after the server answered the socket send, even with a refusal', async () => {
    h.socket = fakeSocket({ status: 'error', code: 'REJECTED' });
    const res = await sendOutboxEntry(entry());
    expect(res).toEqual({ ok: false, failure: { status: 'error', code: 'REJECTED' } });
    expect(h.api.messages.sendMessage).not.toHaveBeenCalled();
  });

  it('sends over REST when there is no socket but the device is online', async () => {
    h.api.messages.sendMessage.mockResolvedValue({ id: 'srv-rest' });
    expect(await sendOutboxEntry(entry())).toEqual({ ok: true, message: { id: 'srv-rest' } });
    h.socket = { connected: false, emit: vi.fn(), timeout: vi.fn() };
    expect(await sendOutboxEntry(entry())).toEqual({ ok: true, message: { id: 'srv-rest' } });
    expect(h.socket.timeout).not.toHaveBeenCalled();
  });

  it('attempts nothing offline: no socket, or a socket that timed out with no network', async () => {
    h.online = false;
    expect(await sendOutboxEntry(entry())).toEqual({ ok: false, offline: true });
    h.socket = { connected: true, emit: vi.fn(), timeout: () => ({ emit: (e, p, cb) => cb(new Error('timeout')) }) };
    expect(await sendOutboxEntry(entry())).toEqual({ ok: false, offline: true });
    expect(h.api.messages.sendMessage).not.toHaveBeenCalled();
  });

  it('treats an empty REST answer as a failure to retry, not a delivery', async () => {
    h.api.messages.sendMessage.mockResolvedValue(undefined);
    expect(await sendOutboxEntry(entry())).toEqual({ ok: false, failure: null });
  });

  it('picks the REST endpoint family by the chat type the entry was made in', async () => {
    h.api.dm.sendMessage.mockResolvedValue({ id: 'd' });
    h.api.group.sendMessage.mockResolvedValue({ id: 'g' });
    h.api.messages.sendMessage.mockResolvedValue({ id: 'm' });
    await sendOutboxEntry(entry({ chatType: 'dm' }));
    await sendOutboxEntry(entry({ chatType: 'group' }));
    await sendOutboxEntry(entry({ chatType: 'messages' }));
    await sendOutboxEntry(entry()); // an entry written before the type was recorded
    expect(h.api.dm.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.api.group.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(2);
    expect(restApiForChatType('dm')).toBe(h.api.dm);
  });
});

describe('the outbox as the only sender', () => {
  const cacheWith = (qc, message) =>
    qc.setQueryData(['messages', 'conv'], { pages: [{ messages: [message] }], pageParams: [undefined] });
  const bubble = (qc) => qc.getQueryData(['messages', 'conv']).pages[0].messages[0];
  const sending = (over = {}) => ({
    id: 'c1', clientId: 'c1', tempId: 'c1', status: 'sending', queued: true, isOptimistic: true,
    payload: { text: 'hi', localPreviewUrl: null }, ...over,
  });

  it('sends one message exactly once over the socket, and finishes the bubble', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    cacheWith(qc, sending());
    h.socket = fakeSocket('ok');
    await outbox.enqueue(entry());
    await outbox.flush();
    await outbox.flush();
    expect(h.socket.emit).toHaveBeenCalledTimes(1);
    expect(h.api.messages.sendMessage).not.toHaveBeenCalled();
    expect(bubble(qc)).toMatchObject({ id: 'srv-c1', clientId: 'c1', status: 'sent', queued: false, isOptimistic: false });
    expect(h.rows.size).toBe(0);
  });

  it('a REST error after a socket success cannot happen: REST is never called, the message stays sent', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    cacheWith(qc, sending());
    h.socket = fakeSocket('ok');
    h.api.messages.sendMessage.mockRejectedValue(restError(400));
    await outbox.enqueue(entry());
    await outbox.flush();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.api.messages.sendMessage).not.toHaveBeenCalled();
    expect(bubble(qc).status).toBe('sent');
  });

  it('an ack timeout then REST success delivers it once and finishes the bubble', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    cacheWith(qc, sending());
    h.socket = fakeSocket('timeout');
    h.api.messages.sendMessage.mockResolvedValue({ id: 'srv-rest', text: 'hi' });
    await outbox.enqueue(entry());
    await outbox.flush();
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(1);
    expect(bubble(qc)).toMatchObject({ id: 'srv-rest', status: 'sent', queued: false, isOptimistic: false });
  });

  it('shows Not delivered for a REST refusal, and keeps the entry for tap-to-retry', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    cacheWith(qc, sending());
    h.api.messages.sendMessage.mockRejectedValue(restError(403));
    await outbox.enqueue(entry());
    await outbox.flush();
    expect(bubble(qc)).toMatchObject({ status: 'failed', queued: false });
    expect(h.rows.get('c1').failed).toBe(true);
  });

  it('queues a message written offline, and delivers it once when the network returns', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    cacheWith(qc, sending());
    h.online = false;
    await outbox.enqueue(entry());
    await outbox.flush();
    expect(bubble(qc)).toMatchObject({ status: 'sending', queued: true });
    expect(h.rows.has('c1')).toBe(true);
    h.online = true;
    h.socket = fakeSocket('ok');
    await outbox.flush();
    expect(h.socket.emit).toHaveBeenCalledTimes(1);
    expect(bubble(qc)).toMatchObject({ status: 'sent', queued: false });
  });

  it('delivers a message storage would not keep exactly once, and finishes the bubble', async () => {
    const { idbOutboxPut } = await import('../idbMessages');
    idbOutboxPut.mockResolvedValueOnce(false);
    const qc = new QueryClient();
    bindOutbox(qc);
    cacheWith(qc, sending());
    h.socket = fakeSocket('ok');
    expect(await outbox.enqueue(entry())).toEqual({ persisted: false, settled: true });
    await outbox.flush();
    expect(h.socket.emit).toHaveBeenCalledTimes(1);
    expect(bubble(qc)).toMatchObject({ status: 'sent', queued: false, isOptimistic: false });
  });

  it('keeps the order of two messages when the first one has to wait', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    h.socket = fakeSocket('timeout');
    h.api.messages.sendMessage.mockRejectedValueOnce(restError(503)).mockResolvedValue({ id: 'srv' });
    await outbox.enqueue(entry({ clientId: 'a', payload: { clientId: 'a', text: 'a' } }));
    await outbox.flush();
    await outbox.enqueue(entry({ clientId: 'b', createdAt: Date.now() + 1, payload: { clientId: 'b', text: 'b' } }));
    await outbox.flush();
    // a failed (503) and is backing off; b did not overtake it.
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.api.messages.sendMessage.mock.calls[0][1].clientId).toBe('a');
  });
});

describe('what a delivered message looks like', () => {
  it('merges the media metadata the entry carries, keeps read, and clears the local preview', () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    qc.setQueryData(['messages', 'conv'], {
      pages: [{ messages: [{
        id: 'c1', clientId: 'c1', tempId: 'c1', status: 'read', queued: true, isOptimistic: true, uploadStatus: 'uploading',
        payload: { text: 'pic', localPreviewUrl: 'blob:local', width: 10 },
      }] }],
      pageParams: [undefined],
    });
    h.socket = fakeSocket('ok');
    const e = entry({ payload: { clientId: 'c1', text: 'pic', mediaUrl: 'https://cdn/x.jpg', thumbnailUrl: 'https://cdn/t.jpg', width: 640, height: 480, duration: 3 } });
    return outbox.enqueue(e).then(() => outbox.flush()).then(() => {
      const m = qc.getQueryData(['messages', 'conv']).pages[0].messages[0];
      expect(m).toMatchObject({
        id: 'srv-c1', status: 'read', queued: false, isOptimistic: false, uploadStatus: 'done', mediaUrl: 'https://cdn/x.jpg',
      });
      expect(m.payload).toMatchObject({ text: 'pic', thumbnailUrl: 'https://cdn/t.jpg', width: 640, height: 480, duration: 3 });
      expect(m.payload.localPreviewUrl).toBeUndefined();
      expect(revoke).toHaveBeenCalledWith('blob:local');
      revoke.mockRestore();
    });
  });

  it('lets server values win over the entry for the same field', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    qc.setQueryData(['messages', 'conv'], { pages: [{ messages: [{ id: 'c1', clientId: 'c1', status: 'sending', payload: {} }] }], pageParams: [undefined] });
    h.socket = fakeSocket({ status: 'ok', message: { id: 'srv', payload: { width: 1, thumbnailUrl: 'srv-t' } } });
    await outbox.enqueue(entry({ payload: { clientId: 'c1', width: 2, thumbnailUrl: 'local-t', height: 5 } }));
    await outbox.flush();
    const m = qc.getQueryData(['messages', 'conv']).pages[0].messages[0];
    expect(m.payload).toMatchObject({ width: 1, thumbnailUrl: 'srv-t', height: 5 });
  });

  it('also updates the chat cached under the other id, on success and on failure', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    const seed = (key) => qc.setQueryData(['messages', key], { pages: [{ messages: [{ id: 'c1', clientId: 'c1', status: 'sending' }] }], pageParams: [undefined] });
    seed('conv'); seed('internal');
    h.socket = fakeSocket('ok');
    await outbox.enqueue(entry({ mirrorConversationId: 'internal' }));
    await outbox.flush();
    // The other copy gets the server's id too, not just a status.
    expect(qc.getQueryData(['messages', 'internal']).pages[0].messages[0]).toMatchObject({ id: 'srv-c1', status: 'sent', queued: false });

    seed('conv'); seed('internal');
    h.socket = fakeSocket({ status: 'error', code: 'REJECTED' });
    await outbox.enqueue(entry({ clientId: 'c1', mirrorConversationId: 'internal' }));
    await outbox.flush();
    expect(qc.getQueryData(['messages', 'internal']).pages[0].messages[0]).toMatchObject({ status: 'failed', queued: false });
  });
});

describe('sendOutboxEntry: a socket that stops answering', () => {
  it('goes REST-first for a while after an ack timeout, so each queued message does not wait out its own', async () => {
    h.socket = fakeSocket('timeout');
    h.api.messages.sendMessage.mockResolvedValue({ id: 'srv-rest' });
    await sendOutboxEntry(entry());
    expect(h.socket.timeout).toHaveBeenCalledTimes(1);
    await sendOutboxEntry(entry({ clientId: 'c2', payload: { clientId: 'c2' } }));
    await sendOutboxEntry(entry({ clientId: 'c3', payload: { clientId: 'c3' } }));
    expect(h.socket.timeout).toHaveBeenCalledTimes(1); // not asked again
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('trusts the socket again after a minute, or after it reconnects', async () => {
    vi.useFakeTimers();
    try {
      h.socket = fakeSocket('timeout');
      h.api.messages.sendMessage.mockResolvedValue({ id: 'srv-rest' });
      await sendOutboxEntry(entry());
      vi.advanceTimersByTime(61_000);
      await sendOutboxEntry(entry());
      expect(h.socket.timeout).toHaveBeenCalledTimes(2);
      noteSocketConnected();
      await sendOutboxEntry(entry());
      expect(h.socket.timeout).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a socket ack that says ok clears the distrust', async () => {
    h.socket = fakeSocket('timeout');
    h.api.messages.sendMessage.mockResolvedValue({ id: 'srv-rest' });
    await sendOutboxEntry(entry());
    noteSocketConnected();
    h.socket = fakeSocket('ok');
    await sendOutboxEntry(entry());
    await sendOutboxEntry(entry());
    expect(h.socket.emit).toHaveBeenCalledTimes(2);
  });
});

describe('sendOutboxEntry: REST cannot throw out of a callback', () => {
  it('turns a synchronous throw while starting the REST send into a failed send', async () => {
    h.api.messages.sendMessage.mockImplementation(() => { throw new Error('boom before a promise'); });
    const res = await sendOutboxEntry(entry());
    expect(res.ok).toBe(false);
    expect(res.failure.message).toBe('boom before a promise');
  });

  it('settles a socket timeout fallback even when REST throws synchronously', async () => {
    h.socket = fakeSocket('timeout');
    h.api.messages.sendMessage.mockImplementation(() => { throw new Error('sync'); });
    const res = await sendOutboxEntry(entry());
    expect(res).toMatchObject({ ok: false });
  });
});

describe('the outbox wakes when connectivity returns', () => {
  const online = () => h.onlineListeners[h.onlineListeners.length - 1];

  it('installs one online subscription, however often it is bound', () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    const count = h.onlineListeners.length;
    bindOutbox(qc);
    bindOutbox(new QueryClient());
    expect(h.onlineListeners.length).toBe(count);
    expect(count).toBe(1);
  });

  it('sends an entry still waiting out a long backoff as soon as the network is back, without a socket', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    h.api.messages.sendMessage.mockRejectedValueOnce(restError(503)).mockResolvedValue({ id: 'srv-rest' });
    await outbox.enqueue(entry());
    await outbox.flush();
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.rows.get('c1').nextAttemptAt).toBeGreaterThan(Date.now());
    await outbox.flush(); // a plain flush respects the backoff
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(1);
    online()(false); // going offline wakes nothing
    await outbox.flush();
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(1);
    online()(true);
    await vi.waitFor(() => expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(h.rows.size).toBe(0));
  });

  it('wakes when the app is brought back to the foreground', async () => {
    bindOutbox(new QueryClient());
    h.api.messages.sendMessage.mockRejectedValueOnce(restError(503)).mockResolvedValue({ id: 'srv-rest' });
    await outbox.enqueue(entry());
    await outbox.flush();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(2));
  });

  it('wakeOutbox ignores the backoff, and sends nothing for a signed-out device', async () => {
    h.api.messages.sendMessage.mockRejectedValueOnce(restError(503)).mockResolvedValue({ id: 'srv-rest' });
    await outbox.enqueue(entry());
    await outbox.flush();
    localStorage.setItem('loggedIn', 'false');
    await wakeOutbox();
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(1);
    localStorage.setItem('loggedIn', 'true');
    await wakeOutbox();
    expect(h.api.messages.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('bound at startup: a REST delivery finishes its bubble with the socket down', () => {
  it('patches the bubble from a REST answer', async () => {
    const qc = new QueryClient();
    bindOutbox(qc); // what main.jsx does, before any socket connects
    qc.setQueryData(['messages', 'conv'], {
      pages: [{ messages: [{ id: 'c1', clientId: 'c1', status: 'sending', queued: true, isOptimistic: true }] }],
      pageParams: [undefined],
    });
    h.api.messages.sendMessage.mockResolvedValue({ id: 'srv-rest' });
    await outbox.enqueue(entry());
    await outbox.flush();
    expect(qc.getQueryData(['messages', 'conv']).pages[0].messages[0]).toMatchObject({
      id: 'srv-rest', status: 'sent', queued: false, isOptimistic: false,
    });
  });
});

describe('a failure never flips a delivered message back', () => {
  const stored = (qc, status) =>
    qc.setQueryData(['messages', 'conv'], { pages: [{ messages: [{ id: 'srv-1', clientId: 'c1', status }] }], pageParams: [undefined] });
  const status = (qc) => qc.getQueryData(['messages', 'conv']).pages[0].messages[0].status;

  it.each(['sent', 'delivered', 'read', 'seen'])('keeps a %s bubble as it is when the outbox gives up', async (state) => {
    const qc = new QueryClient();
    bindOutbox(qc);
    stored(qc, state);
    h.socket = fakeSocket({ status: 'error', code: 'REJECTED' });
    await outbox.enqueue(entry());
    await outbox.flush();
    expect(status(qc)).toBe(state);
  });

  it('still marks a sending bubble failed', async () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    stored(qc, 'sending');
    h.socket = fakeSocket({ status: 'error', code: 'REJECTED' });
    await outbox.enqueue(entry());
    await outbox.flush();
    expect(status(qc)).toBe('failed');
  });

  it('applies the same rule to the stored row: the disk patch declines a confirmed one', async () => {
    const { idbPatchMessage } = await import('../idbMessages');
    idbPatchMessage.mockClear();
    h.socket = fakeSocket({ status: 'error', code: 'REJECTED' });
    await outbox.enqueue(entry());
    await outbox.flush();
    const call = idbPatchMessage.mock.calls.find(([, , patch]) => typeof patch === 'function');
    expect(call).toBeDefined();
    const patch = call[2];
    expect(patch({ id: 'c1', status: 'sent' })).toBeNull();
    expect(patch({ id: 'c1', status: 'read' })).toBeNull();
    // A refusal ('REJECTED' ack) is recorded as one, so the bubble can say so.
    const failed = { status: 'failed', queued: false, failReason: 'refused' };
    expect(patch({ id: 'c1', status: 'sending' })).toEqual(failed);
    expect(patch(null)).toEqual(failed);
  });
});
