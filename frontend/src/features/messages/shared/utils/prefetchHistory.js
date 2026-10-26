/**
 * A conversation's first page of history, fetched before the chat is opened.
 *
 * WHY
 * Opening a chat that is not in memory slid in a skeleton, and its messages
 * replaced it once the network answered: recorded on the I2208 (2026-10-26),
 * the bubbles arrived ~0.9 s after the slide had finished, so every first open
 * after a launch ended in a jump. The history is read-only to fetch (marking
 * as read is a separate POST), so it can be asked for earlier:
 *   - on the press that opens it (the press, the screenshot and the commit
 *     take a few hundred milliseconds before the slide even starts), and
 *   - for the first few conversations in the list, when the list is idle,
 *     which are the ones a returning user opens.
 *
 * WHAT IT DOES NOT CHANGE
 * The chat still never shows the device's saved copy while online
 * (useChatManager): what this stores is the server's own answer. It is stored
 * STALE (`updatedAt: 0`), so the chat's own query still fetches on open, with
 * everything that query folds in — the outbox's unsent messages and anything
 * the socket delivered while it was on the wire — and the prefetched page is
 * only what is on screen until that lands. Socket updates reach a cached chat
 * whether or not it is open (SocketManager, useGlobalSocketSync), so the page
 * keeps up meanwhile. Nothing is written over data the chat already has.
 */

/** Requests in flight, by conversation id, so one chat is never asked for twice at once. */
const inFlight = new Set();

/** The cache key the chat itself reads (useChatManager): the id in its URL. */
export const historyKey = (chatId) => ['messages', chatId];

/** The id a conversation's URL carries, which is what the chat's query is keyed by. */
export const routeIdOf = (conv) => (conv ? String(conv.publicId || conv.id || '') : '');

/**
 * Fetches `chatId`'s first page into the cache unless it is there or on its way.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string} chatId  the id in the chat's URL
 * @param {{ getHistory: (id: string) => Promise<{ messages?: object[] }> }} api
 */
export function prefetchChatHistory(queryClient, chatId, api) {
  if (!queryClient || !chatId || !api?.getHistory) return;
  if (String(chatId).startsWith('temp_') || String(chatId).startsWith('c_temp_') || String(chatId).startsWith('draft_')) return;
  const key = historyKey(chatId);
  if (inFlight.has(chatId)) return;
  if (queryClient.getQueryData(key)?.pages?.length) return;
  if (queryClient.getQueryState(key)?.fetchStatus === 'fetching') return;

  inFlight.add(chatId);
  Promise.resolve()
    .then(() => api.getHistory(chatId))
    .then((res) => {
      if (!res || !Array.isArray(res.messages)) return;
      // The chat opened meanwhile and its own answer is in: that one is newer.
      if (queryClient.getQueryData(key)?.pages?.length) return;
      const page = { ...res, messages: res.messages.map((m) => ({ ...m, status: m.status || 'sent' })) };
      queryClient.setQueryData(key, { pages: [page], pageParams: [undefined] }, { updatedAt: 0 });
    })
    .catch(() => {
      // Nothing was prefetched; the chat fetches for itself when it opens.
    })
    .finally(() => inFlight.delete(chatId));
}

/** For tests: forget what is in flight. */
export function resetHistoryPrefetch() {
  inFlight.clear();
}
