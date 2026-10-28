import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  applyMessageToConversationList,
  applyReadToConversationList,
  markUnsentInConversationList,
  newestLoadedMessage,
  replaceDeletedPreview,
  resetConversationListMemory,
} from '../conversationList';
import { messagePreviewText } from '../messagePreview';
import { sumUnread } from '../../../hooks/useUnreadCounts';

/**
 * The conversation list under real event traffic: repeated, late and
 * out-of-order events, unsends, and reads on another device.
 */
const t = (min) => new Date(Date.UTC(2026, 9, 28, 10, min)).toISOString();

const row = (over = {}) => ({
  id: 'pub-1',
  publicId: 'pub-1',
  internalId: 'int-1',
  type: 'DM',
  unreadCount: 0,
  unread: 0,
  lastMessage: { id: 'm1', text: 'first', createdAt: t(1) },
  updatedAt: t(1),
  timestamp: Date.parse(t(1)),
  ...over,
});
const msg = (id, min, over = {}) => ({ id, conversationId: 'pub-1', text: `text ${id}`, createdAt: t(min), senderId: 'them', ...over });

let qc;
beforeEach(() => {
  qc = new QueryClient();
  resetConversationListMemory();
});
const list = () => qc.getQueryData(['conversations']);
const first = () => list()[0];

describe('a message arriving', () => {
  it('updates the preview and counts it once, however many times it is delivered', () => {
    qc.setQueryData(['conversations'], [row()]);
    applyMessageToConversationList(qc, msg('m2', 2), { countUnread: true });
    applyMessageToConversationList(qc, msg('m2', 2), { countUnread: true });
    applyMessageToConversationList(qc, { ...msg('m2', 2), internalId: 'int-1' }, { countUnread: true });
    expect(first()).toMatchObject({ unreadCount: 1, lastMsg: 'text m2' });
  });

  it('a late, older message counts but does not replace the newer preview', () => {
    qc.setQueryData(['conversations'], [row()]);
    applyMessageToConversationList(qc, msg('m3', 3), { countUnread: true });
    applyMessageToConversationList(qc, msg('m2', 2), { countUnread: true });
    expect(first()).toMatchObject({ unreadCount: 2, lastMsg: 'text m3', timestamp: Date.parse(t(3)) });
  });

  it('never counts the viewer\'s own message, and moves only rows with newer activity', () => {
    qc.setQueryData(['conversations'], [row({ id: 'pub-2', publicId: 'pub-2', internalId: 'int-2', lastMessage: { id: 'x', createdAt: t(5) }, timestamp: Date.parse(t(5)) }), row()]);
    applyMessageToConversationList(qc, msg('m2', 2, { senderId: 'me' }));
    expect(list().map((c) => c.id)).toEqual(['pub-2', 'pub-1']);
    applyMessageToConversationList(qc, msg('m9', 9));
    expect(list().map((c) => c.id)).toEqual(['pub-1', 'pub-2']);
    expect(first().unreadCount).toBe(0);
  });

  it('the same optimistic message applied again (by clientId) does not move the row back', () => {
    qc.setQueryData(['conversations'], [row({ lastMessage: { clientId: 'c-1', text: 'hi', createdAt: t(4) }, timestamp: Date.parse(t(4)) })]);
    applyMessageToConversationList(qc, { ...msg('m4', 3), clientId: 'c-1', text: 'hi', isOptimistic: true });
    expect(first()).toMatchObject({ lastMsg: 'hi', timestamp: Date.parse(t(4)) });
  });

  it('the server copy of an optimistic message brings the server time, so a later reply still moves the preview', () => {
    qc.setQueryData(['conversations'], [row()]);
    // This device's clock is 5 minutes ahead.
    applyMessageToConversationList(qc, { clientId: 'c-9', conversationId: 'pub-1', text: 'mine', createdAt: t(15), isOptimistic: true });
    applyMessageToConversationList(qc, { id: 'm9', clientId: 'c-9', conversationId: 'pub-1', text: 'mine', createdAt: t(10) });
    applyMessageToConversationList(qc, msg('m10', 11), { countUnread: true });
    expect(first()).toMatchObject({ lastMsg: 'text m10', unreadCount: 1 });
  });

  it('reports a conversation it has no row for, so the caller refetches', () => {
    qc.setQueryData(['conversations'], [row()]);
    expect(applyMessageToConversationList(qc, { ...msg('m2', 2), conversationId: 'other' })).toBe('missing');
  });
});

describe('unsend', () => {
  it('changes the row only when it was the message the row shows', () => {
    qc.setQueryData(['conversations'], [row({ lastMessage: { id: 'm5', text: 'latest', createdAt: t(5) } })]);
    markUnsentInConversationList(qc, { ids: ['pub-1'], messageId: 'm4', createdAt: t(4) });
    expect(first().lastMessage.text).toBe('latest');
    markUnsentInConversationList(qc, { ids: ['pub-1'], messageId: 'm5', createdAt: t(5) });
    expect(first()).toMatchObject({ lastMsg: 'This message was unsent' });
  });
});

describe('read on another device', () => {
  it('clears the count when nothing arrived after the read', () => {
    qc.setQueryData(['conversations'], [row({ unreadCount: 3, unread: 3, lastMessage: { id: 'm2', createdAt: t(2) } })]);
    expect(applyReadToConversationList(qc, { ids: ['int-1'], readAt: t(3) })).toBe(false);
    expect(first().unreadCount).toBe(0);
  });

  it('asks for a refetch when a message arrived after the read', () => {
    qc.setQueryData(['conversations'], [row({ unreadCount: 3, unread: 3, lastMessage: { id: 'm4', createdAt: t(4) } })]);
    expect(applyReadToConversationList(qc, { ids: ['pub-1'], readAt: t(3) })).toBe(true);
    expect(first().unreadCount).toBe(3);
  });
});

describe('delete for me', () => {
  it('falls back to the message before it, moving the row back', () => {
    qc.setQueryData(['conversations'], [row({ lastMessage: { id: 'm5', text: 'gone', createdAt: t(5) }, timestamp: Date.parse(t(5)) })]);
    qc.setQueryData(['messages', 'pub-1'], { pages: [{ messages: [msg('m3', 3), msg('m4', 4), msg('m5', 5)] }], pageParams: [undefined] });
    const replacement = newestLoadedMessage(qc, 'pub-1', 'm5');
    expect(replaceDeletedPreview(qc, { ids: ['pub-1'], messageId: 'm5', replacement })).toBe(false);
    expect(first()).toMatchObject({ lastMsg: 'text m4', timestamp: Date.parse(t(4)) });
  });

  it('asks for a refetch when no earlier message is loaded', () => {
    qc.setQueryData(['conversations'], [row({ lastMessage: { id: 'm5', createdAt: t(5) } })]);
    expect(replaceDeletedPreview(qc, { ids: ['pub-1'], messageId: 'm5', replacement: null })).toBe(true);
  });
});

describe('messagePreviewText: one line per kind of message', () => {
  it.each([
    [{ text: 'hello' }, 'hello'],
    [{ text: '', mediaUrl: 'chat/a.webp', mediaType: 'image' }, 'Photo'],
    [{ mediaUrl: 'chat/a.mp4', mediaType: 'video' }, 'Video'],
    [{ mediaUrl: 'voice/a.webm', mediaType: 'audio' }, 'Voice message'],
    [{ mediaUrl: 'chat/a.bin', mediaType: 'pdf' }, 'Attachment'],
    [{ inviteData: { type: 'postShare' } }, 'Shared a post'],
    [{ inviteData: { type: 'confessionShare', confessionId: 'x' } }, 'Shared a confession'],
    [{ inviteData: { groupName: 'Hikers' } }, 'Group invite: Hikers'],
    [{ state: 'UNSENT', text: 'secret' }, 'This message was unsent'],
    [{ type: 'system', text: '@ana joined the group' }, '@ana joined the group'],
    [{ payload: { text: 'from payload' } }, 'from payload'],
  ])('%o → %s', (m, expected) => {
    expect(messagePreviewText(m)).toBe(expected);
  });
});

describe('the navigation badge', () => {
  it('adds up rows, but not muted chats or groups the viewer has left', () => {
    expect(sumUnread([
      { id: 'a', unreadCount: 2 },
      { id: 'b', isGroup: true, unreadCount: 3 },
      { id: 'c', unreadCount: 5, muted: true },
      { id: 'd', isGroup: true, unreadCount: 4, isMember: false },
      { id: 'e', unreadCount: -2 },
    ])).toEqual({ dm: 2, group: 3, total: 5 });
  });
});
