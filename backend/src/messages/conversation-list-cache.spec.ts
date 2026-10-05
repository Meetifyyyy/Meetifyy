import {
  conversationListCacheKey,
  conversationListFirstPageKeys,
} from './conversation-list-cache';

describe('conversation-list cache keys', () => {
  it('evicts exactly the first page the inbox and the picker cache', () => {
    const keys = conversationListFirstPageKeys('u1');
    expect(keys).toContain(conversationListCacheKey('u1', 50, 0, '', false));
    expect(keys).toContain(conversationListCacheKey('u1', 50, 0, '', true));
  });
});
