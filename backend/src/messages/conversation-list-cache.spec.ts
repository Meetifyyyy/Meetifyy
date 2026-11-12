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

  it('has an eviction key for every key it can produce', () => {
    const evicted = new Set(conversationListFirstPageKeys('u1'));
    for (let limit = 0; limit <= 60; limit++) {
      for (const eligibleOnly of [false, true]) {
        const key = conversationListCacheKey('u1', limit, 0, '', eligibleOnly);
        if (key) expect(evicted.has(key)).toBe(true);
      }
    }
  });

  it('does not cache searched, deep or oddly sized pages', () => {
    expect(conversationListCacheKey('u1', 50, 0, 'priya', false)).toBeNull();
    expect(conversationListCacheKey('u1', 50, 0, '   ', false)).not.toBeNull();
    expect(conversationListCacheKey('u1', 50, 50, '', false)).toBeNull();
    expect(conversationListCacheKey('u1', 7, 0, '', false)).toBeNull();
    expect(conversationListCacheKey('u1', 50, 10000, '', true)).toBeNull();
  });

  it('cannot produce more keys per viewer than it can evict', () => {
    const produced = new Set<string>();
    for (const limit of [1, 20, 30, 50, 51, 9999]) {
      for (const offset of [0, 1, 20, 10000]) {
        for (const search of ['', 'a', 'x'.repeat(10 * 1024)]) {
          for (const eligibleOnly of [false, true]) {
            const key = conversationListCacheKey(
              'u1',
              limit,
              offset,
              search,
              eligibleOnly,
            );
            if (key) produced.add(key);
          }
        }
      }
    }
    expect(produced.size).toBe(conversationListFirstPageKeys('u1').length);
  });
});
