import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const captured = vi.hoisted(() => ({ onSent: null }));
vi.mock('../outbox', () => ({
  createOutbox: (deps) => { captured.onSent = deps.onSent; return {}; },
}));
vi.mock('../idbMessages', () => ({
  idbOutboxAll: vi.fn(async () => []),
  idbOutboxDelete: vi.fn(async () => {}),
  idbOutboxPut: vi.fn(async () => {}),
  idbPatchMessage: vi.fn(async () => {}),
}));
vi.mock('@stores/useGlobalSocketStore', () => ({ useGlobalSocketStore: { getState: () => ({ socket: null }) } }));

import { restorableOutboxMessages } from '../outboxRestore';
import { bindOutbox } from '../outboxClient';

const me = { id: 'u1' };
const entry = (over = {}) => ({
  clientId: 'c1', userId: 'u1', conversationId: 'conv-pub', createdAt: 1_700_000_000_000, attempts: 0,
  payload: { text: 'hi', mediaUrl: null, replyToId: 'r9' }, ...over,
});

describe('restorableOutboxMessages', () => {
  it('shows a restored entry as a bubble after a cold history load', () => {
    const page = [{ id: 's1', text: 'old', createdAt: '2023-01-01T00:00:00.000Z' }];
    const out = restorableOutboxMessages([entry(), entry({ clientId: 'c2', failed: true })], ['conv-int', 'conv-pub'], page, me);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ clientId: 'c1', status: 'sending', queued: true, isOptimistic: true, senderId: 'u1', text: 'hi', replyToId: 'r9' });
    expect(out[0].createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(out[1]).toMatchObject({ clientId: 'c2', status: 'failed', queued: false });
  });

  it('does not duplicate an entry the page already contains', () => {
    const page = [{ id: 'server-1', clientId: 'c1' }];
    expect(restorableOutboxMessages([entry()], ['conv-pub'], page, me)).toEqual([]);
  });

  it('ignores entries for other conversations', () => {
    expect(restorableOutboxMessages([entry({ conversationId: 'other' })], ['conv-pub'], [], me)).toEqual([]);
  });
});

describe('outboxClient markSent', () => {
  it('appends the confirmed message when the loaded chat has no copy', () => {
    const qc = new QueryClient();
    qc.setQueryData(['messages', 'conv-pub'], { pages: [{ messages: [{ id: 's1', text: 'old', createdAt: '2023-01-01T00:00:00.000Z' }] }], pageParams: [undefined] });
    bindOutbox(qc);
    captured.onSent(entry(), { id: 'server-9', text: 'hi', createdAt: '2023-11-14T22:13:20.000Z', senderId: 'u1' });
    const msgs = qc.getQueryData(['messages', 'conv-pub']).pages.flatMap((p) => p.messages);
    const sent = msgs.find((m) => m.id === 'server-9');
    expect(sent).toMatchObject({ clientId: 'c1', status: 'sent' });
    expect(msgs.filter((m) => m.clientId === 'c1')).toHaveLength(1);
  });

  it('does not create a cache for a chat that is not loaded', () => {
    const qc = new QueryClient();
    bindOutbox(qc);
    captured.onSent(entry(), { id: 'server-9', text: 'hi' });
    expect(qc.getQueryData(['messages', 'conv-pub'])).toBeUndefined();
  });
});
