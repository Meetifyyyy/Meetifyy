/**
 * Default options for every mutation, shared by the website and the app.
 *
 * `networkMode: 'always'`. TanStack's default, 'online', pauses a mutation
 * while offline: `mutate()` returns, `isPending` stays true (a spinner that
 * never stops), nothing is sent, and the whole thing fires on its own when the
 * network comes back, possibly minutes later, after the person has moved on,
 * with no feedback at all. That is a hidden queue.
 *
 * 'always' runs the mutation immediately. Offline the request fails at once
 * (no retries: mutations have `retry: 0`), so the usual error path shows a
 * message and a form keeps its content. 'offlineFirst' would behave the same for
 * the first attempt but pauses between retries, and there are none to pause.
 *
 * Most actions are stopped even earlier, by `blockIfOffline` before anything is
 * sent or applied optimistically; this default is the backstop for the rest.
 * Messages do not use mutations at all; their outbox queues on purpose.
 */
export const mutationDefaults = {
  networkMode: 'always',
};
