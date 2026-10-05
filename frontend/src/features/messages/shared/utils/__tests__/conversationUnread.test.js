import { describe, expect, it } from 'vitest';
import { matchesConversationId, withConversationUnreadCleared } from '../cacheUtils';

/**
 * Opening a chat zeroes its unread count; a message arriving increments it.
 * Both must recognise the conversation by the same rule, or a chat opened by an
 * id the arrival side understood stays badged after being read.
 */
const rows = () => [
  { id: 'c_AbC123', publicId: 'AbC123', unreadCount: 2, unread: 2 },
  { id: 'Zx9', publicId: 'Zx9', internalId: 'uuid-1', unreadCount: 1, unread: 1 },
  { id: 'Qq1', publicId: 'Qq1', username: 'asha', unreadCount: 3, unread: 3 },
];

describe('withConversationUnreadCleared', () => {
  it('clears by the same ids a message arrival matches by', () => {
    // Each of these is an id `matchesConversationId` accepts for the row.
    for (const [target, index] of [
      ['AbC123', 0], // without the `c_` the row's id carries
      ['c_abc123', 0], // different case
      ['uuid-1', 1], // internal id
      ['ASHA', 2], // partner username
    ]) {
      expect(matchesConversationId(rows()[index], target)).toBe(true);
      const next = withConversationUnreadCleared(rows(), target);
      expect(next[index]).toMatchObject({ unreadCount: 0, unread: 0 });
      // Only that conversation changes.
      next.forEach((row, i) => {
        if (i !== index) expect(row.unreadCount).toBe(rows()[i].unreadCount);
      });
    }
  });

  it('returns the same array when there is nothing to clear', () => {
    const list = [{ id: 'a', unreadCount: 0, unread: 0 }];
    expect(withConversationUnreadCleared(list, 'a')).toBe(list);
    expect(withConversationUnreadCleared(rows(), 'no-such-chat').length).toBe(3);
  });

  it('leaves a non-list cache value and an empty target alone', () => {
    expect(withConversationUnreadCleared(undefined, 'a')).toBeUndefined();
    const list = rows();
    expect(withConversationUnreadCleared(list, '')).toBe(list);
  });
});
