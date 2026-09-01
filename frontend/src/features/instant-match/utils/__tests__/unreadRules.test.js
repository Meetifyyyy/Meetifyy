import { describe, it, expect } from 'vitest';
import { evaluateUnread } from '../unreadRules';

const liveSession = {
  matchId: 'm1',
  conversationId: 'conv-1',
  isActive: true,
};

const base = {
  session: liveSession,
  currentUserId: 'alice',
  isViewing: false,
  counted: new Set(),
};

const from = (senderId, over = {}) => ({
  id: 'msg-1',
  conversationId: 'conv-1',
  senderId,
  ...over,
});

describe('evaluateUnread', () => {
  it('counts a message from the other person while the chat is closed', () => {
    expect(evaluateUnread({ ...base, message: from('bob') })).toEqual({
      count: true,
      markRead: false,
      messageId: 'msg-1',
    });
  });

  it('never counts the viewer\'s own message', () => {
    expect(evaluateUnread({ ...base, message: from('alice') }).count).toBe(false);
    // The multi-device copy, which arrives flagged rather than by sender id.
    expect(
      evaluateUnread({ ...base, message: from(null, { from: 'me' }) }).count,
    ).toBe(false);
  });

  it('marks read instead of counting when the chat is on screen', () => {
    expect(
      evaluateUnread({ ...base, message: from('bob'), isViewing: true }),
    ).toEqual({ count: false, markRead: true, messageId: 'msg-1' });
  });

  it('counts a duplicated event only once', () => {
    const counted = new Set();
    const first = evaluateUnread({ ...base, counted, message: from('bob') });
    counted.add(first.messageId);
    const second = evaluateUnread({ ...base, counted, message: from('bob') });

    expect(first.count).toBe(true);
    expect(second.count).toBe(false);
  });

  it('ignores a message from a different conversation', () => {
    expect(
      evaluateUnread({
        ...base,
        message: from('bob', { conversationId: 'conv-other', publicId: 'conv-other' }),
      }).count,
    ).toBe(false);
  });

  it('matches on any id the server may stamp the message with', () => {
    // The chat state holds the internal id; the message is keyed by the public
    // one and carries the internal id alongside it.
    expect(
      evaluateUnread({
        ...base,
        message: from('bob', { conversationId: 'conv-public', internalId: 'conv-1' }),
      }).count,
    ).toBe(true);
  });

  it('ignores everything once the session has ended', () => {
    expect(
      evaluateUnread({
        ...base,
        session: { ...liveSession, isActive: false },
        message: from('bob'),
      }),
    ).toEqual({ count: false, markRead: false, messageId: null });
  });

  it('ignores everything when there is no session at all', () => {
    expect(
      evaluateUnread({ ...base, session: null, message: from('bob') }).count,
    ).toBe(false);
  });

  it('does not carry a previous session forward: a new session id means a new conversation', () => {
    // Session 2 between the same two people. A message addressed to session
    // 1's conversation must not badge it.
    const session2 = { matchId: 'm2', conversationId: 'conv-2', isActive: true };
    expect(
      evaluateUnread({ ...base, session: session2, message: from('bob') }).count,
    ).toBe(false);
  });
});
