import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installFakeIndexedDB } from '../../../../../shared/lib/__tests__/helpers/fakeIndexedDB';

/**
 * The message cache is bounded once per launch, and never at the expense of a
 * message that has not been delivered.
 *
 * The outbox store holds sends the app has promised to retry; the rows that
 * stand for them in the message store carry `queued`, or a 'sending'/'failed'
 * status, and the outbox names them by clientId. Dropping any of those would
 * lose something the person wrote.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const at = (ms) => new Date(NOW - ms).toISOString();

let fake;
let m;
beforeEach(async () => {
  fake = installFakeIndexedDB();
  vi.resetModules();
  m = await import('../idbMessages');
  await m.idbGetSyncMeta('warm-up'); // opens the database
});

const db = () => fake.db('meetifyy_messages');
const messages = () => db().stores.get('messages').data;
const outboxStore = () => db().stores.get('outbox').data;
const meta = () => db().stores.get('sync_metadata').data;
const seed = (rows) => rows.forEach((r) => messages().set(r.id, r));
const row = (id, conversationId, ageMs, extra = {}) => ({
  id, conversationId, createdAt: at(ageMs), status: 'sent', text: id, ...extra,
});
const ids = () => [...messages().keys()].sort();

describe('trimMessageCache', () => {
  it('keeps the newest messages of each conversation', async () => {
    seed(Array.from({ length: 12 }, (_, i) => row(`m${i}`, 'c1', (12 - i) * 1000))); // m11 newest
    const removed = await m.trimMessageCache({ perConversation: 5, maxConversations: 60, maxTotal: 5000 });
    expect(removed).toBe(7);
    expect(ids()).toEqual(['m10', 'm11', 'm7', 'm8', 'm9']);
  });

  it('drops the least recently active conversations beyond the limit, with their cursors', async () => {
    // c0 is the oldest conversation, c4 the newest.
    seed(Array.from({ length: 5 }, (_, i) => row(`m${i}`, `c${i}`, (5 - i) * 1000)));
    for (let i = 0; i < 5; i += 1) meta().set(`c${i}`, { conversationId: `c${i}`, nextCursor: 'x' });

    await m.trimMessageCache({ perConversation: 300, maxConversations: 3, maxTotal: 5000 });

    expect(ids()).toEqual(['m2', 'm3', 'm4']);
    expect([...meta().keys()].sort()).toEqual(['c2', 'c3', 'c4']);
  });

  it('holds the total to the ceiling, oldest first, across conversations', async () => {
    seed([
      ...Array.from({ length: 4 }, (_, i) => row(`a${i}`, 'ca', (100 - i) * 1000)),
      ...Array.from({ length: 4 }, (_, i) => row(`b${i}`, 'cb', (50 - i) * 1000)),
    ]);
    await m.trimMessageCache({ perConversation: 300, maxConversations: 60, maxTotal: 5 });
    expect(messages().size).toBe(5);
    expect(ids()).toEqual(['a3', 'b0', 'b1', 'b2', 'b3']);
  });

  it('never removes an unsent row, even far past every limit', async () => {
    const old = 30 * DAY;
    seed([
      // Named by the outbox, under the id the server has since given it.
      row('srv_1', 'c1', old, { clientId: 'client_a' }),
      // Queued, and sending, with no outbox entry yet (a media send uploads first).
      row('tmp_q', 'c1', old, { queued: true, status: 'sending' }),
      row('tmp_s', 'c1', 5 * 1000, { status: 'sending' }),
      // Failed recently.
      row('tmp_f', 'c1', 2 * DAY, { status: 'failed' }),
      // Ordinary history, all of it older than the cap allows.
      ...Array.from({ length: 6 }, (_, i) => row(`h${i}`, 'c1', (10 - i) * 1000)),
    ]);
    outboxStore().set('client_a', { clientId: 'client_a', userId: 'u1', conversationId: 'c1' });

    await m.trimMessageCache({ perConversation: 2, maxConversations: 1, maxTotal: 3 });

    const left = ids();
    expect(left).toEqual(expect.arrayContaining(['srv_1', 'tmp_q', 'tmp_s', 'tmp_f']));
    // Everything else is trimmed.
    expect(left.filter((id) => id.startsWith('h'))).toEqual([]);
  });

  it('protects unsent rows in a conversation that is itself dropped', async () => {
    seed([
      row('new', 'fresh', 1000),
      row('queued', 'idle', 90 * DAY, { queued: true }),
      row('plain', 'idle', 90 * DAY),
    ]);
    await m.trimMessageCache({ perConversation: 300, maxConversations: 1, maxTotal: 5000 });
    expect(ids()).toEqual(['new', 'queued']);
  });

  it('keeps a failed message however old, so "Not delivered" never silently vanishes', async () => {
    seed([row('failed', 'c1', 30 * DAY, { status: 'failed' }), row('ok', 'c1', 1000)]);
    await m.trimMessageCache({ perConversation: 1, maxConversations: 60, maxTotal: 5000 });
    expect(ids().sort()).toEqual(['failed', 'ok']);
  });

  it('lets a row stuck at "sending" with no outbox entry go after a week', async () => {
    seed([row('stuck', 'c1', 30 * DAY, { status: 'sending' }), row('ok', 'c1', 1000)]);
    await m.trimMessageCache({ perConversation: 1, maxConversations: 60, maxTotal: 5000 });
    expect(ids()).toEqual(['ok']);
  });

  it('never touches the outbox', async () => {
    seed(Array.from({ length: 8 }, (_, i) => row(`m${i}`, 'c1', (8 - i) * 1000)));
    outboxStore().set('k1', { clientId: 'k1', userId: 'u1', conversationId: 'gone' });
    outboxStore().set('k2', { clientId: 'k2', userId: 'u2', conversationId: 'c1', failed: true });

    await m.trimMessageCache({ perConversation: 1, maxConversations: 1, maxTotal: 1 });

    expect([...outboxStore().keys()].sort()).toEqual(['k1', 'k2']);
    expect((await m.idbOutboxAll('u1')).map((e) => e.clientId)).toEqual(['k1']);
  });

  it('does nothing when a sign-out has started the next generation', async () => {
    seed(Array.from({ length: 8 }, (_, i) => row(`m${i}`, 'c1', (8 - i) * 1000)));
    const pass = m.trimMessageCache({ perConversation: 1 });
    await m.idbClearMessages();
    expect(await pass).toBe(0);
    expect(messages().size).toBe(0); // the sign-out's own clear, not the trim's
  });

  it('does nothing to a cache that is within every limit', async () => {
    seed([row('a', 'c1', 3000), row('b', 'c1', 2000), row('c', 'c2', 1000)]);
    expect(await m.trimMessageCache()).toBe(0);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });
});

describe('idbClearMessageCache', () => {
  it('empties history and cursors but keeps unsent rows and the whole outbox', async () => {
    seed([
      row('h1', 'c1', 3000),
      row('h2', 'c2', 2000),
      row('srv_9', 'c1', 1000, { clientId: 'client_z' }),
      row('draft_q', 'c2', 1000, { queued: true }),
    ]);
    meta().set('c1', { conversationId: 'c1', nextCursor: 'x' });
    outboxStore().set('client_z', { clientId: 'client_z', userId: 'u1', conversationId: 'c1' });
    outboxStore().set('client_y', { clientId: 'client_y', userId: 'u1', conversationId: 'c3', failed: true });
    const epoch = m.idbMessagesEpoch();

    expect(await m.idbClearMessageCache()).toBe(true);

    expect(ids()).toEqual(['draft_q', 'srv_9']);
    expect(meta().size).toBe(0);
    expect([...outboxStore().keys()].sort()).toEqual(['client_y', 'client_z']);
    // No new generation: the outbox abandons work begun under an older one.
    expect(m.idbMessagesEpoch()).toBe(epoch);
  });
});
