/**
 * Coalesce rapid per-conversation setting writes down to the last one.
 *
 * Mute and pin are toggles sitting in a context menu, and a user who taps
 * twice quickly used to produce two racing requests whose order of arrival —
 * not the order of the taps — decided the stored value. The UI, updated
 * optimistically on every tap, then disagreed with the server until something
 * refetched.
 *
 * This keeps the optimistic path untouched (callers still update local state
 * on every single tap) and only delays the network write, re-reading the
 * settled state from the cache when it finally runs. Keys are per action and
 * per conversation, so muting one chat never delays pinning another.
 *
 * Module-level rather than per-hook: two components mounting the same hook
 * must share one timer, or each gets its own and the coalescing does nothing.
 */
const pending = new Map();

export const CONVERSATION_WRITE_DEBOUNCE_MS = 300;

export function scheduleConversationWrite(key, run, delay = CONVERSATION_WRITE_DEBOUNCE_MS) {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pending.delete(key);
    // Invoked synchronously so the write starts the moment the timer fires;
    // both the throw and the rejection paths are swallowed here because every
    // caller does its own rollback and toast inside `run`.
    try {
      const result = run();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) { /* caller owns its error handling */ }
  }, delay);
  pending.set(key, timer);
}

/** Test seam: drop every scheduled write without running it. */
export function __resetConversationWriteQueue() {
  pending.forEach((timer) => clearTimeout(timer));
  pending.clear();
}
