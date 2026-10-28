/**
 * The outbox: messages sent but not yet confirmed by the server.
 *
 * It is the ONLY thing that sends a chat message. The chat screen builds the
 * bubble, uploads any media, records the send here and asks for a flush; this
 * file's flush hands each entry to `send` (socket ack, REST fallback; see
 * outboxClient.js) and reports the outcome through `onSent` / `onFailed`. There
 * used to be a second, direct send in the screen with a hand-off between the
 * two, and the races in that hand-off (a REST fallback failing with a 4xx after
 * the socket had already delivered) could mark a delivered message failed.
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
 *   OUTBOX_MAX_AGE_MS, leaving the message "Not sent" with tap-to-retry.
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
/**
 * A send that has not answered in this long is treated as a transient failure,
 * so one that never settles cannot hold the whole outbox (flushing stays set
 * while it is awaited). Longer than the socket ack wait plus a REST attempt.
 */
const SEND_WATCHDOG_MS = 45_000;

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
 * Whether a transient failure never reached the server at all (fetch failed, a
 * timeout, an abort): an Error with no HTTP status. A 5xx, a 429, a socket ack
 * saying no, or an empty answer all came back from somewhere, so only the one
 * message is at fault. A network failure is shared by every chat.
 */
export function isNetworkFailure(failure) {
  return failure instanceof Error && typeof failure.status !== 'number';
}

/**
 * The outbox logic, with its effects injected so it can be tested without a
 * socket, React or IndexedDB.
 *
 * @param {object} deps
 * @param {{ put(entry, epoch?): Promise<void>, delete(clientId): Promise<void>, all(userId): Promise<object[]> }} deps.store
 * @param {(entry) => Promise<{ ok: true, message?: object } | { ok: false, failure?: unknown, offline?: boolean }>} deps.send
 * @param {(entry, serverMsg, generation?) => void} deps.onSent   the server confirmed it
 * @param {(entry, generation?, failure?) => void} deps.onFailed  given up, or refused;
 *   `failure` is the last attempt's (a socket ack or an HTTP error), so the
 *   bubble can say why
 * @param {() => string | null} deps.getUserId
 * @param {() => number} [deps.getGeneration] changes when the local caches are
 *   cleared (sign-out); work started under an older one writes and sends nothing
 * @param {() => number} [deps.now]
 * @param {number} [deps.sendTimeoutMs] the watchdog on one send (default 45s)
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
  sendTimeoutMs = SEND_WATCHDOG_MS,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
}) {
  /**
   * clientIds being sent right now, with when the send started, so nothing
   * sends one twice. A mark older than IN_FLIGHT_EXPIRY_MS is treated as
   * abandoned (a send that never settled), so it cannot block its conversation
   * until the app restarts.
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
  /** A wake-up (connect, online, resume) was asked for: the next pass ignores backoff. */
  let wakeAgain = false;
  /**
   * Attempts and the next due time per clientId, for when the store would not
   * take the write (so a failing entry still backs off, and still reaches
   * "failed", instead of being retried at once, for ever).
   */
  const soft = new Map();
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
    // Unreadable: try again next time rather than trust an empty state.
    if (!Array.isArray(entries)) return;
    for (const e of entries) if (!e.failed) track(e);
    loadedFor = userId;
  }

  /**
   * What ordering is kept per: one chat can be addressed by its public or its
   * internal id, so a caller that knows the canonical one passes `orderKey`;
   * otherwise the conversation id it sent to.
   */
  const orderKeyOf = (entry) => entry.orderKey ?? entry.conversationId;
  const track = (entry) => {
    const key = orderKeyOf(entry);
    const list = pendingByConv.get(key) ?? [];
    if (!list.includes(entry.clientId)) list.push(entry.clientId);
    pendingByConv.set(key, list);
  };
  const untrack = (entry) => {
    const key = orderKeyOf(entry);
    const list = (pendingByConv.get(key) ?? []).filter((id) => id !== entry.clientId);
    if (list.length) pendingByConv.set(key, list);
    else pendingByConv.delete(key);
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
   * Runs `send(entry)` under the watchdog: a send that never answers resolves
   * as a transient network failure instead of blocking the outbox for good. If
   * it does answer later the server has deduped it by clientId, so the next
   * attempt is safe.
   */
  function sendWithWatchdog(entry) {
    let watchdog;
    const expired = new Promise((resolve) => {
      watchdog = setTimeout(
        () => resolve({ ok: false, failure: new Error('send timed out') }),
        sendTimeoutMs,
      );
    });
    let attempt;
    try {
      attempt = Promise.resolve(send(entry));
    } catch (err) {
      // Thrown before it returned a promise.
      attempt = Promise.resolve({ ok: false, failure: err });
    }
    return Promise.race([attempt, expired]).finally(() => clearTimeout(watchdog));
  }

  /**
   * Applies the outcome of one attempt to `entry`. Reports what became of it:
   * 'sent', 'failed' (given up or refused; the chat can carry on past it),
   * 'rescheduled' (it waits for its backoff, and what follows it in the chat
   * waits too) or 'stale' (signed out meanwhile; nothing was done).
   */
  async function settle(entry, outcome, detail, { generation } = {}) {
    // Signed out (or switched account) since this attempt began: the store was
    // emptied, and writing this entry back would keep the previous account's
    // message on the device. Nothing is written, nobody is notified.
    if (generation !== undefined && generation !== getGeneration()) return 'stale';
    if (outcome === 'ok') {
      untrack(entry);
      soft.delete(entry.clientId);
      // The screen is told BEFORE the row goes: killed in between, the stored
      // message already says "sent", and the leftover entry is only sent again
      // (the server returns the same message), where the other order left a
      // stored message "sending" with nothing left to deliver it.
      onSent(entry, detail, generation);
      await store.delete(entry.clientId);
      return 'sent';
    }
    const attempts = Math.max(entry.attempts ?? 0, soft.get(entry.clientId)?.attempts ?? 0) + 1;
    const tooOld = now() - (entry.createdAt ?? now()) > OUTBOX_MAX_AGE_MS;
    if (outcome === 'rejected' || attempts >= OUTBOX_MAX_ATTEMPTS || tooOld) {
      // Kept, marked failed, so tap-to-retry can send exactly this again.
      untrack(entry);
      soft.delete(entry.clientId);
      const kept = await store.put({ ...entry, attempts, failed: true, failedAt: now() }, generation);
      // Not stored as failed: left as it was it would be sent again by itself,
      // behind a "Not sent" the person can see. The screen's retry rebuilds
      // a send from the bubble when there is no entry.
      if (kept === false) await store.delete(entry.clientId);
      if (generation !== undefined && generation !== getGeneration()) return 'stale';
      onFailed(entry, generation, detail);
      return 'failed';
    }
    const delay = retryDelay(attempts);
    soft.set(entry.clientId, { attempts, nextAttemptAt: now() + delay });
    await store.put({ ...entry, attempts, nextAttemptAt: now() + delay }, generation);
    scheduleFlush(delay);
    return 'rescheduled';
  }

  /** Sends every due entry, oldest first, one conversation at a time. */
  async function runFlush({ ignoreBackoff = false } = {}) {
    const userId = getUserId();
    if (!userId) return;
    const generation = getGeneration();
    const entries = await store.all(userId);
    // Could not read the store: an error, so the flush retries later instead
    // of concluding there is nothing to send.
    if (!Array.isArray(entries)) throw new Error('outbox unreadable');
    const byConv = new Map();
    for (const entry of entries) {
      if (entry.failed) {
        // Purge failed entries nobody retried within a week.
        if (now() - (entry.failedAt ?? 0) > OUTBOX_FAILED_KEEP_MS) await store.delete(entry.clientId);
        continue;
      }
      track(entry);
      const list = byConv.get(orderKeyOf(entry)) ?? [];
      list.push(entry);
      byConv.set(orderKeyOf(entry), list);
    }
    let earliestWait = Infinity;
    // A network failure ends the whole run: every other chat would meet the
    // same dead connection, one watchdog or ack wait after another.
    let networkDown = false;
    for (const [convKey, list] of byConv) {
      if (networkDown) break;
      // A message that could not be stored is being delivered once, outside
      // this list; anything behind it in the chat waits for it to settle.
      const ahead = (pendingByConv.get(convKey) ?? []).some(
        (id) => isInFlight(id) && !list.some((e) => e.clientId === id),
      );
      if (ahead) continue;
      for (const entry of list) {
        // Signed out, or someone else signed in, while this run was sending:
        // stop, so no message goes out under the next account's session.
        if (getUserId() !== entry.userId || getGeneration() !== generation) return;
        // Already being sent (a send that has not settled); what follows in
        // this conversation must wait for it.
        if (isInFlight(entry.clientId)) break;
        const dueAt = Math.max(entry.nextAttemptAt ?? 0, soft.get(entry.clientId)?.nextAttemptAt ?? 0);
        const wait = ignoreBackoff ? 0 : dueAt - now();
        if (wait > 0) {
          earliestWait = Math.min(earliestWait, wait);
          break;
        }
        inFlight.set(entry.clientId, now());
        let result;
        try {
          result = await sendWithWatchdog(entry);
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
        const settled = await settle(entry, outcome, result?.failure, { generation });
        if (outcome === 'transient' && isNetworkFailure(result?.failure)) {
          networkDown = true;
          // An entry that just gave up has no timer of its own, and the ones
          // behind it were not tried: come back once the connection has had a
          // moment.
          if (settled === 'failed') earliestWait = Math.min(earliestWait, RETRY_BASE_MS);
          break;
        }
        // A transient failure that is retried keeps the rest of this
        // conversation in order behind it. A refusal, or an entry that has
        // just given up, does not hold up the messages after it: they are
        // sent now, since nothing is left ahead of them.
        if (settled === 'rescheduled') break;
      }
    }
    if (earliestWait !== Infinity) scheduleFlush(earliestWait);
  }

  /**
   * Sends what is due. Safe to call often (connect, online, resume): one run at
   * a time, and a call during a run asks for one more pass afterwards.
   *
   * `{ now: true }` is for a wake-up (the connection came back, the socket
   * reconnected, the app resumed): entries waiting out a backoff are sent now
   * instead of after it, as the long wait was for a connection that has changed.
   */
  function flush({ now: immediately = false } = {}) {
    if (immediately) wakeAgain = true;
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    flushing = (async () => {
      try {
        do {
          flushAgain = false;
          const ignoreBackoff = wakeAgain;
          wakeAgain = false;
          await runFlush({ ignoreBackoff });
        } while (flushAgain);
      } catch {
        // Storage failure: entries stay where they are. Try again later
        // rather than only on the next connect, but only when something is
        // known to be waiting: with storage unavailable and nothing pending, a
        // timer would fire every 30s for the life of the page.
        if (pendingByConv.size > 0) scheduleFlush(FLUSH_ERROR_RETRY_MS);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  /**
   * Delivers an entry storage would not keep: once, through the same `send`,
   * with the outcome reported at once. A failure of any kind is final (nothing
   * is left to retry it), so it shows as "Not sent" with tap-to-retry
   * instead of "Sending…" forever. While it is out, it holds back newer
   * messages of its chat, as a stored one would.
   */
  async function deliverUnsaved(entry, epoch, blocked) {
    const stale = () => epoch !== undefined && epoch !== getGeneration();
    if (stale()) return;
    if (blocked) {
      // An older message is still pending: sending now would overtake it.
      onFailed(entry, epoch);
      return;
    }
    track(entry);
    inFlight.set(entry.clientId, now());
    let result;
    try {
      result = await sendWithWatchdog(entry);
    } catch (err) {
      result = { ok: false, failure: err };
    } finally {
      inFlight.delete(entry.clientId);
      untrack(entry);
    }
    if (!stale()) {
      if (result?.ok) onSent(entry, result.message, epoch);
      else onFailed(entry, epoch, result?.failure);
    }
    // Newer messages of this chat were held behind it.
    void flush();
  }

  return {
    /**
     * Records a send and asks for a flush; the flush is what sends it, in order
     * behind anything older in the same conversation. Resolves once the entry
     * is stored (not once it is delivered). The chat is told the outcome
     * through `onSent` / `onFailed`.
     *
     * Returns `{ persisted, settled }`. `persisted: false` means storage
     * refused it (full or blocked), so the outbox cannot retry it: it is then
     * delivered once, directly, through the same `send`, and `settled: true`
     * says the outcome was already reported. If an older message in the chat
     * is still pending, an unsaved one must not overtake it, so it is reported
     * failed (tap-to-retry) without a send.
     */
    async enqueue(entry, epoch) {
      try {
        await loadPending(entry.userId);
      } catch {
        // Unreadable storage: order is then best-effort, the send still goes.
      }
      const older = (pendingByConv.get(orderKeyOf(entry)) ?? []).filter((id) => id !== entry.clientId);
      const persisted = (await store.put({ attempts: 0, nextAttemptAt: 0, ...entry }, epoch)) !== false;
      if (!persisted) {
        await deliverUnsaved(entry, epoch, older.length > 0);
        return { persisted: false, settled: true };
      }
      track(entry);
      void flush();
      return { persisted: true, settled: false };
    },
    /** Tap-to-retry: revive a failed entry and send it again. */
    async retry(clientId) {
      const generation = getGeneration();
      const userId = getUserId();
      if (!userId) return false;
      const entry = ((await store.all(userId)) ?? []).find((e) => e.clientId === clientId);
      if (!entry) return false;
      // Carries the generation like every other write, so a retry racing a
      // sign-out cannot write the previous account's entry back.
      soft.delete(clientId);
      const stored = await store.put(
        { ...entry, failed: false, failedAt: undefined, attempts: 0, nextAttemptAt: 0 },
        generation,
      );
      if (generation !== getGeneration()) return false;
      // Not revived: nothing would send it. The caller delivers it once
      // instead (the unsaved path) rather than showing "Sending…" for ever.
      if (stored === false) return false;
      await flush();
      return true;
    },
    /** True when an entry for `clientId` exists, failed or not. */
    async has(clientId) {
      const userId = getUserId();
      if (!userId) return false;
      return ((await store.all(userId)) ?? []).some((e) => e.clientId === clientId);
    },
    flush,
    /** True while a message in `conversationId` is still waiting to be confirmed. */
    hasPending(conversationId) {
      return (pendingByConv.get(conversationId) ?? []).length > 0;
    },
    /** Forget in-memory state (sign-out). The store itself is cleared elsewhere. */
    reset() {
      inFlight.clear();
      soft.clear();
      pendingByConv.clear();
      loadedFor = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
      timerAt = Infinity;
    },
  };
}
