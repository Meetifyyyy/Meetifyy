/**
 * The outbox: messages sent but not yet confirmed by the server.
 *
 * Every send is recorded here before it goes out and removed once the server
 * confirms it, so a send interrupted by a dropped connection, a timeout, or the
 * app being killed is not lost: it is sent again on the next connect, in the
 * order it was written, until it lands or clearly cannot.
 *
 * Auto-resend existed once as a localStorage queue and was removed. These are
 * the ways that design failed, and what this one does instead:
 *
 * - It was not scoped to an account, so a queued message could be sent as
 *   whoever signed in next. Entries carry their `userId`, only the signed-in
 *   account's are flushed, and sign-out empties the store (idbClearMessages).
 * - It re-sent everything on every reconnect, forever. Retries back off
 *   (2s doubling to 5 min) and stop after OUTBOX_MAX_ATTEMPTS or
 *   OUTBOX_MAX_AGE_MS, leaving the message "Not delivered" with tap-to-retry.
 * - It could not tell a network failure from a refusal, so a message to
 *   someone who had blocked the sender was retried indefinitely. The server
 *   now classifies refusals (`code: 'REJECTED'`) and those are never retried.
 * - Retries could duplicate. Each retry carries the original clientId, which
 *   the server matches against `clientMessageId` under a per-id lock.
 *
 * Messages in one conversation go out in order: a later one waits while an
 * earlier one is still pending, as WhatsApp's clock icon does.
 */

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Failed entries are kept for tap-to-retry, but not forever. */
export const OUTBOX_FAILED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_BASE_MS = 2_000;
/** A send that has not reported back in this long is treated as abandoned. */
const IN_FLIGHT_EXPIRY_MS = 60_000;
/** After a storage failure during a flush. */
const FLUSH_ERROR_RETRY_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;

/** Wait before attempt number `attempts + 1`. */
export function retryDelay(attempts) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * Whether a failed send may be retried.
 *
 * 'rejected' only when the server said so: a socket ack with
 * `code: 'REJECTED'`, or an HTTP 4xx other than 408 and 429. Everything else
 * (no ack, a timeout, a dropped connection, 5xx, rate limiting, a server too
 * old to send a code) is 'transient'.
 */
export function classifySendFailure(failure) {
  if (failure && typeof failure === 'object') {
    if (failure.code === 'REJECTED') return 'rejected';
    const status = typeof failure.status === 'number' ? failure.status : undefined;
    if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return 'rejected';
    }
  }
  return 'transient';
}

/**
 * The outbox logic, with its effects injected so it can be tested without a
 * socket, React or IndexedDB.
 *
 * @param {object} deps
 * @param {{ put(entry, epoch?): Promise<void>, delete(clientId): Promise<void>, all(userId): Promise<object[]> }} deps.store
 * @param {(entry) => Promise<{ ok: true, message?: object } | { ok: false, failure?: unknown, offline?: boolean }>} deps.send
 * @param {(entry, serverMsg) => void} deps.onSent        the server confirmed it
 * @param {(entry) => void} deps.onFailed                  given up, or refused
 * @param {() => string | null} deps.getUserId
 * @param {() => number} [deps.getGeneration] changes when the local caches are
 *   cleared (sign-out); work started under an older one writes and sends nothing
 * @param {() => number} [deps.now]
 * @param {(fn, ms) => unknown} [deps.setTimer]
 * @param {(handle) => void} [deps.clearTimer]
 */
export function createOutbox({
  store,
  send,
  onSent,
  onFailed,
  getUserId,
  getGeneration = () => 0,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
}) {
  /**
   * clientIds being sent right now, with when the send started, so nothing
   * sends one twice. A mark older than IN_FLIGHT_EXPIRY_MS is treated as
   * abandoned (a send that threw before reporting back), so it cannot block
   * its conversation until the app restarts.
   */
  const inFlight = new Map();
  const isInFlight = (clientId) => {
    const since = inFlight.get(clientId);
    if (since === undefined) return false;
    if (now() - since > IN_FLIGHT_EXPIRY_MS) {
      inFlight.delete(clientId);
      return false;
    }
    return true;
  };
  /** conversationId -> clientIds still pending, oldest first (ordering). */
  const pendingByConv = new Map();
  let flushing = null;
  let flushAgain = false;
  let timer = null;
  let timerAt = Infinity;
  /** The account whose stored entries `pendingByConv` already reflects. */
  let loadedFor = null;

  /**
   * Fills the ordering state from storage once per account. After a restart
   * it is empty until something reads the store, and a new message checked
   * against it would overtake an older one still waiting on disk.
   */
  async function loadPending(userId) {
    if (!userId || loadedFor === userId) return;
    const entries = await store.all(userId);
    for (const e of entries) if (!e.failed) track(e);
    loadedFor = userId;
  }

  const track = (entry) => {
    const list = pendingByConv.get(entry.conversationId) ?? [];
    if (!list.includes(entry.clientId)) list.push(entry.clientId);
    pendingByConv.set(entry.conversationId, list);
  };
  const untrack = (entry) => {
    const list = (pendingByConv.get(entry.conversationId) ?? []).filter((id) => id !== entry.clientId);
    if (list.length) pendingByConv.set(entry.conversationId, list);
    else pendingByConv.delete(entry.conversationId);
  };

  /** Keeps the EARLIEST pending deadline: a long backoff in one chat must not push back a short one in another. */
  const scheduleFlush = (delayMs) => {
    const at = now() + Math.max(0, delayMs);
    if (timer !== null && timerAt <= at) return;
    if (timer !== null) clearTimer(timer);
    timerAt = at;
    timer = setTimer(() => {
      timer = null;
      timerAt = Infinity;
      void flush();
    }, Math.max(0, delayMs));
  };

  /**
   * Applies the outcome of one attempt to `entry`. `notify` is off for the
   * chat screen's own direct send, which updates the bubble itself.
   */
  async function settle(entry, outcome, detail, { notify = true, generation } = {}) {
    // Signed out (or switched account) since this attempt began: the store was
    // emptied, and writing this entry back would keep the previous account's
    // message on the device. Nothing is written, nobody is notified.
    if (generation !== undefined && generation !== getGeneration()) return;
    if (outcome === 'ok') {
      untrack(entry);
      await store.delete(entry.clientId);
      if (notify) onSent(entry, detail);
      return;
    }
    const attempts = (entry.attempts ?? 0) + 1;
    const tooOld = now() - (entry.createdAt ?? now()) > OUTBOX_MAX_AGE_MS;
    if (outcome === 'rejected' || attempts >= OUTBOX_MAX_ATTEMPTS || tooOld) {
      // Kept, marked failed, so tap-to-retry can send exactly this again.
      untrack(entry);
      await store.put({ ...entry, attempts, failed: true, failedAt: now() }, generation);
      if (notify) onFailed(entry);
      return;
    }
    const delay = retryDelay(attempts);
    await store.put({ ...entry, attempts, nextAttemptAt: now() + delay }, generation);
    scheduleFlush(delay);
  }

  /** Sends every due entry, oldest first, one conversation at a time. */
  async function runFlush() {
    const userId = getUserId();
    if (!userId) return;
    const generation = getGeneration();
    const entries = await store.all(userId);
    const byConv = new Map();
    for (const entry of entries) {
      if (entry.failed) {
        // Purge failed entries nobody retried within a week.
        if (now() - (entry.failedAt ?? 0) > OUTBOX_FAILED_KEEP_MS) await store.delete(entry.clientId);
        continue;
      }
      track(entry);
      const list = byConv.get(entry.conversationId) ?? [];
      list.push(entry);
      byConv.set(entry.conversationId, list);
    }
    let earliestWait = Infinity;
    for (const list of byConv.values()) {
      for (const entry of list) {
        // Signed out, or someone else signed in, while this run was sending:
        // stop, so no message goes out under the next account's session.
        if (getUserId() !== entry.userId || getGeneration() !== generation) return;
        // Another path is sending it right now; what follows must wait for it.
        if (isInFlight(entry.clientId)) break;
        const wait = (entry.nextAttemptAt ?? 0) - now();
        if (wait > 0) {
          earliestWait = Math.min(earliestWait, wait);
          break;
        }
        inFlight.set(entry.clientId, now());
        let result;
        try {
          result = await send(entry);
        } catch (err) {
          result = { ok: false, failure: err };
        } finally {
          inFlight.delete(entry.clientId);
        }
        if (result?.ok) {
          await settle(entry, 'ok', result.message, { generation });
          continue;
        }
        // Not connected: nothing was attempted, so nothing is counted. The
        // next connect flushes again; offline for a day loses no attempts.
        if (result?.offline) return;
        const outcome = classifySendFailure(result?.failure);
        await settle(entry, outcome, result?.failure, { generation });
        // A transient failure keeps the rest of this conversation in order
        // behind it; a refusal does not hold up the messages after it.
        if (outcome === 'transient') break;
      }
    }
    if (earliestWait !== Infinity) scheduleFlush(earliestWait);
  }

  /**
   * Sends what is due. Safe to call often (connect, online, resume): one run at
   * a time, and a call during a run asks for one more pass afterwards.
   */
  function flush() {
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    flushing = (async () => {
      try {
        do {
          flushAgain = false;
          await runFlush();
        } while (flushAgain);
      } catch {
        // Storage failure: entries stay where they are. Try again later
        // rather than only on the next connect.
        scheduleFlush(FLUSH_ERROR_RETRY_MS);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  return {
    /**
     * Records a send before it goes out. Returns true when it may go out now,
     * false when an older message in the same conversation is still pending
     * and this one has to wait its turn (the flush will send it).
     */
    async enqueue(entry, epoch, { viaFlush = false } = {}) {
      try {
        await loadPending(entry.userId);
      } catch {
        // Unreadable storage: order is then best-effort, the send still goes.
      }
      const persisted = (await store.put({ attempts: 0, nextAttemptAt: 0, ...entry }, epoch)) !== false;
      // Not recorded (storage full or blocked): the outbox cannot retry it, so
      // the caller sends it the old way and shows a failure as a failure.
      if (!persisted) return { sendNow: true, persisted: false };
      const older = (pendingByConv.get(entry.conversationId) ?? []).filter((id) => id !== entry.clientId);
      track(entry);
      // `viaFlush`: the caller does not send it itself (tap-to-retry of a
      // message the outbox never had), so the flush takes it, in order.
      if (older.length > 0 || viaFlush) {
        void flush();
        return { sendNow: false, persisted: true };
      }
      inFlight.set(entry.clientId, now());
      return { sendNow: true, persisted: true };
    },
    /**
     * The chat screen's direct send of an enqueued entry finished. The screen
     * shows the outcome itself; a transient failure is left queued and the
     * flush takes it from there.
     */
    async complete(entry, outcome, detail, generation) {
      inFlight.delete(entry.clientId);
      await settle(entry, outcome, detail, { notify: false, generation });
      // Anything queued behind it in the conversation can go now.
      if (outcome !== 'transient') void flush();
    },
    /** Tap-to-retry: revive a failed entry and send it again. */
    async retry(clientId) {
      const userId = getUserId();
      if (!userId) return false;
      const entry = (await store.all(userId)).find((e) => e.clientId === clientId);
      if (!entry) return false;
      await store.put({ ...entry, failed: false, failedAt: undefined, attempts: 0, nextAttemptAt: 0 });
      await flush();
      return true;
    },
    /** True when an entry for `clientId` exists, failed or not. */
    async has(clientId) {
      const userId = getUserId();
      if (!userId) return false;
      return (await store.all(userId)).some((e) => e.clientId === clientId);
    },
    flush,
    /** True while a message in `conversationId` is still waiting to be confirmed. */
    hasPending(conversationId) {
      return (pendingByConv.get(conversationId) ?? []).length > 0;
    },
    /** Forget in-memory state (sign-out). The store itself is cleared elsewhere. */
    reset() {
      inFlight.clear();
      pendingByConv.clear();
      loadedFor = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
      timerAt = Infinity;
    },
  };
}
