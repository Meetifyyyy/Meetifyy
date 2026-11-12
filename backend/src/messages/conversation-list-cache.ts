/**
 * The conversation-list cache's keys, in one place.
 *
 * The list is cached per viewer under a versioned prefix (`v3`: v2 entries
 * were written while the since-removed first-year isolation filter applied,
 * v1 before it). The evictors were once not updated when a prefix was added:
 * they deleted `user:conversations:<id>:<limit>:0` and scanned
 * `user:conversations:<id>:*`, neither of which matches a versioned key. So
 * nothing was ever evicted — a send, a block or an account deletion left every
 * participant's list stale for the full TTL, and a client refetching right
 * after sending could be handed the list from before it.
 *
 * Writer and evictors now build keys from the same functions, so they cannot
 * drift apart again. The key of a cacheable page is unchanged since `v3`, so
 * the prefix was not bumped when searched and deeper pages stopped being
 * stored: their old entries are unreachable and expire with their TTL.
 */
export const CONVERSATION_LIST_CACHE_PREFIX = 'user:conversations:v3:';

/**
 * The page sizes clients request. The inbox asks for 50 and the share/forward
 * picker for 50 (eligible only); 20 and 30 are older clients' defaults that
 * installed apps may still send.
 */
const COMMON_LIMITS = [20, 30, 50];

/**
 * The key one cached page of a viewer's conversation list is stored under, or
 * `null` when the request is not the shape worth caching.
 *
 * Only the first, unsearched page at a common page size is stored. That is the
 * page a client opens and refetches after every change, and it is the one set
 * of keys the evictors below can name; a searched or deeper page is a one-off
 * that nothing could evict after a send, so it used to sit stale for the whole
 * TTL while also letting a client mint keys from its own search text and
 * offsets. Those requests are answered from the database instead.
 */
export function conversationListCacheKey(
  userId: string,
  limit: number,
  offset: number,
  search: string,
  eligibleOnly: boolean,
): string | null {
  if (offset !== 0 || search.trim() !== '') return null;
  if (!COMMON_LIMITS.includes(limit)) return null;
  return `${CONVERSATION_LIST_CACHE_PREFIX}${eligibleOnly ? 'pick:' : ''}${userId}:${limit}:0:`;
}

/**
 * The first page, unsearched, of both list variants at every common page size:
 * what a client actually refetches after a change. Built directly rather than
 * found with SCAN, which walks the whole keyspace and is too slow to run on
 * every message send.
 */
export function conversationListFirstPageKeys(userId: string): string[] {
  const keys: string[] = [];
  for (const limit of COMMON_LIMITS) {
    for (const eligibleOnly of [false, true]) {
      const key = conversationListCacheKey(userId, limit, 0, '', eligibleOnly);
      if (key) keys.push(key);
    }
  }
  return keys;
}

/**
 * The version counter of a group's cached details (GroupChatsService
 * getGroupDetails). Bumping it retires every viewer's cached copy at once.
 * Shared so both services that change membership can bump it.
 */
export function groupDetailsVersionKey(realConvId: string): string {
  return `groupDetails:ver:${realConvId}`;
}
