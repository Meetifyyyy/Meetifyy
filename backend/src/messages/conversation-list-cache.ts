/**
 * The conversation-list cache's keys, in one place.
 *
 * The list is cached per viewer under a `v2` prefix (v1 entries predate the
 * first-year isolation filter). The evictors were never updated when that
 * prefix was added: they deleted `user:conversations:<id>:<limit>:0` and
 * scanned `user:conversations:<id>:*`, neither of which matches a `v2` key. So
 * nothing was ever evicted — a send, a block or an account deletion left every
 * participant's list stale for the full TTL, and a client refetching right
 * after sending could be handed the list from before it.
 *
 * Writer and evictors now build keys from the same functions, so they cannot
 * drift apart again.
 */
export const CONVERSATION_LIST_CACHE_PREFIX = 'user:conversations:v2:';

/** The key one cached page of a viewer's conversation list is stored under. */
export function conversationListCacheKey(
  userId: string,
  limit: number,
  offset: number,
  search: string,
  eligibleOnly: boolean,
): string {
  return `${CONVERSATION_LIST_CACHE_PREFIX}${eligibleOnly ? 'pick:' : ''}${userId}:${limit}:${offset}:${search.toLowerCase()}`;
}

/**
 * The page sizes clients request. The inbox asks for 50 and the share/forward
 * picker for 50 (eligible only); 20 and 30 are older clients' defaults that
 * installed apps may still send.
 */
const COMMON_LIMITS = [20, 30, 50];

/**
 * The first page, unsearched, of both list variants at every common page size:
 * what a client actually refetches after a change. Built directly rather than
 * found with SCAN, which walks the whole keyspace and is too slow to run on
 * every message send.
 */
export function conversationListFirstPageKeys(userId: string): string[] {
  const keys: string[] = [];
  for (const limit of COMMON_LIMITS) {
    keys.push(conversationListCacheKey(userId, limit, 0, '', false));
    keys.push(conversationListCacheKey(userId, limit, 0, '', true));
  }
  return keys;
}
