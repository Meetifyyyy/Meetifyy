import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  appendMessageToCache,
  purgeConversationFromCaches,
  applyGroupRoleChange,
} from '../cacheUtils';

const msg = (id, text = 'hi') => ({ id, text, createdAt: new Date().toISOString() });

const history = (messages, nextCursor) => ({
  pages: [{ messages, nextCursor }],
  pageParams: [undefined],
});

let qc;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('appendMessageToCache', () => {
  it('refuses to invent a history for a conversation that has none', () => {
    // The bug: seeding `{ pages: [{ messages: [msg], nextCursor: undefined }] }`
    // here made an unopened chat look fully loaded with exactly one message, so
    // opening it from a toast showed that message and could never load the rest.
    appendMessageToCache(qc, 'conv-1', msg('m1'));
    expect(qc.getQueryData(['messages', 'conv-1'])).toBeUndefined();
  });

  it('seeds a history only when the caller opts in, for the chat on screen', () => {
    appendMessageToCache(qc, 'conv-1', msg('m1'), { createIfMissing: true });
    const data = qc.getQueryData(['messages', 'conv-1']);
    expect(data.pages[0].messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('appends into an existing history without disturbing its cursor', () => {
    qc.setQueryData(['messages', 'conv-1'], history([msg('m1')], 'cursor-1'));
    appendMessageToCache(qc, 'conv-1', msg('m2'));
    const page = qc.getQueryData(['messages', 'conv-1']).pages[0];
    expect(page.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(page.nextCursor).toBe('cursor-1');
  });

  it('is idempotent — the same message twice stays one message', () => {
    qc.setQueryData(['messages', 'conv-1'], history([msg('m1')], undefined));
    appendMessageToCache(qc, 'conv-1', msg('m2'));
    appendMessageToCache(qc, 'conv-1', msg('m2'));
    expect(qc.getQueryData(['messages', 'conv-1']).pages[0].messages).toHaveLength(2);
  });
});

describe('purgeConversationFromCaches', () => {
  const conversations = [
    { id: 'internal-1', publicId: 'pub-1', internalId: 'internal-1', otherUser: { username: 'ana' } },
    { id: 'internal-2', publicId: 'pub-2', internalId: 'internal-2' },
  ];

  beforeEach(() => {
    qc.setQueryData(['conversations'], conversations);
    qc.setQueryData(['messages', 'pub-1'], history([msg('m1')], undefined));
    qc.setQueryData(['messages', 'internal-1'], history([msg('m1')], undefined));
    qc.setQueryData(['messages', 'pub-2'], history([msg('m9')], undefined));
  });

  it('removes the row when called with any of the conversation\'s ids', () => {
    // The bug: matching on `c.id === convId` alone left the row on screen
    // whenever the caller held a publicId or a username instead.
    purgeConversationFromCaches(qc, 'pub-1', conversations);
    expect(qc.getQueryData(['conversations']).map((c) => c.id)).toEqual(['internal-2']);
  });

  it('drops every cached history the conversation is addressable by', () => {
    purgeConversationFromCaches(qc, 'pub-1', conversations);
    expect(qc.getQueryData(['messages', 'pub-1'])).toBeUndefined();
    expect(qc.getQueryData(['messages', 'internal-1'])).toBeUndefined();
  });

  it('leaves other conversations completely alone', () => {
    purgeConversationFromCaches(qc, 'pub-1', conversations);
    expect(qc.getQueryData(['messages', 'pub-2'])).toBeDefined();
  });

  it('returns the aliases it purged, so the offline mirror can match them', () => {
    const aliases = purgeConversationFromCaches(qc, 'pub-1', conversations);
    expect(aliases).toEqual(expect.arrayContaining(['pub-1', 'internal-1', 'ana']));
  });
});

describe('applyGroupRoleChange', () => {
  beforeEach(() => {
    qc.setQueryData(['conversations'], [
      { id: 'g1', publicId: 'g1', admins: [], isGroup: true },
    ]);
    qc.setQueryData(['groupDetails', 'g1'], {
      id: 'g1',
      publicId: 'g1',
      admins: [],
      members: ['u1', 'u2'],
      memberDetails: [
        { userId: 'u1', role: 'MEMBER' },
        { userId: 'u2', role: 'MEMBER' },
      ],
    });
  });

  it('promotes in the conversation row and the group details together', () => {
    // The bug: only the conversation row was patched, so Group Details kept
    // showing the old role for the length of its 5-minute staleTime.
    applyGroupRoleChange(qc, 'g1', 'u1', 'ADMIN');

    expect(qc.getQueryData(['conversations'])[0].admins).toEqual(['u1']);
    const details = qc.getQueryData(['groupDetails', 'g1']);
    expect(details.admins).toEqual(['u1']);
    expect(details.members).toEqual(['u2']);
    expect(details.memberDetails.find((m) => m.userId === 'u1').role).toBe('ADMIN');
  });

  it('demotes back out of admin and into members', () => {
    applyGroupRoleChange(qc, 'g1', 'u1', 'ADMIN');
    applyGroupRoleChange(qc, 'g1', 'u1', 'MEMBER');

    expect(qc.getQueryData(['conversations'])[0].admins).toEqual([]);
    const details = qc.getQueryData(['groupDetails', 'g1']);
    expect(details.admins).toEqual([]);
    expect(details.members).toEqual(expect.arrayContaining(['u1', 'u2']));
  });

  it('is idempotent, so the optimistic patch and the echoed event agree', () => {
    applyGroupRoleChange(qc, 'g1', 'u1', 'ADMIN');
    applyGroupRoleChange(qc, 'g1', 'u1', 'ADMIN');
    expect(qc.getQueryData(['groupDetails', 'g1']).admins).toEqual(['u1']);
  });

  it('records a new owner', () => {
    applyGroupRoleChange(qc, 'g1', 'u2', 'OWNER');
    expect(qc.getQueryData(['groupDetails', 'g1']).ownerId).toBe('u2');
    expect(qc.getQueryData(['conversations'])[0].ownerId).toBe('u2');
  });
});
