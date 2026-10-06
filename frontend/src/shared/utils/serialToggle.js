/**
 * Ordered, coalesced requests for an on/off action (save, follow, join).
 *
 * The toggles used to debounce taps and, when the intent flipped while a
 * request was out, abort it and send the opposite one. Aborting a fetch does
 * not un-send it: the server usually had the first request already, so both
 * were processed — by whichever replica got them, in whichever order they
 * landed — and the server could finish in the opposite state to the screen.
 *
 * Here, per entity:
 *  - at most ONE request is in flight, and nothing is ever aborted;
 *  - a tap while it is out only records the newest intent;
 *  - when it returns, one follow-up is sent if that intent still differs from
 *    what the server now holds, otherwise nothing.
 *
 * So the server sees the person's actions in the order they made them, and a
 * burst of taps costs at most two requests. The first tap is sent at once — no
 * debounce delay before anything reaches the server.
 *
 * Callers keep their own optimistic cache writes; this only orders the
 * network and reports back:
 *  - `onConfirmed(target, response, isFinal)` after each successful request;
 *    `isFinal` is true when nothing further will be sent for this burst;
 *  - `onFailed(error, { desired, confirmed })` when a request fails. The
 *    server is still at `confirmed`; the caller restores that if the screen
 *    shows `desired` and they differ.
 *
 * The callbacks passed with the latest tap are the ones used, so they always
 * close over the newest render's state.
 */

const entries = new Map();

function pump(key, entry) {
  if (entry.inFlight) return;
  if (entry.desired === entry.confirmed) {
    entries.delete(key);
    return;
  }
  entry.inFlight = true;
  const target = entry.desired;

  Promise.resolve()
    .then(() => entry.io.send(target))
    .then((res) => {
      entry.inFlight = false;
      entry.confirmed = target;
      const isFinal = entry.desired === target;
      entry.io.onConfirmed?.(target, res, isFinal);
      pump(key, entry);
    })
    .catch((err) => {
      entry.inFlight = false;
      const desired = entry.desired;
      entries.delete(key);
      entry.io.onFailed?.(err, { desired, confirmed: entry.confirmed });
    });
}

/**
 * Record a tap's intent and make sure the server follows it, in order.
 *
 * @param {string} key entity key, e.g. `savePost:<id>`
 * @param {boolean} intent the state the person just asked for
 * @param {{ send: (target: boolean) => Promise<unknown>,
 *           onConfirmed?: (target: boolean, res: unknown, isFinal: boolean) => void,
 *           onFailed?: (err: unknown, s: { desired: boolean, confirmed: boolean }) => void }} io
 */
export function requestToggle(key, intent, io) {
  let entry = entries.get(key);
  if (!entry) {
    // A tap flips what was shown, so before it the server held the opposite.
    entry = { confirmed: !intent, desired: intent, inFlight: false, io };
    entries.set(key, entry);
  }
  entry.desired = intent;
  entry.io = io;
  pump(key, entry);
}

/** True while a request for this entity is out or about to go. */
export function isTogglePending(key) {
  return entries.has(key);
}

/** For tests. */
export function __resetSerialToggles() {
  entries.clear();
}
