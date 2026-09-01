/**
 * Marks that THIS tab has just scheduled its own deletion and is showing the
 * confirmation countdown.
 *
 * Without it the two screens fight. The countdown lives inside the app tree,
 * and `AccountDeletionGate` replaces that tree the moment it learns the account
 * is pending — which happens within a second, because any background request
 * comes back 403 and `applyAccountStatusCorrection` writes the new status. The
 * user would confirm their deletion and watch the confirmation vanish, replaced
 * by a screen offering to undo it.
 *
 * `sessionStorage`, not `localStorage`, and deliberately: this is true of one
 * tab, not of the account. Another tab open at the same time SHOULD see the
 * recovery gate, and a tab opened later should too.
 *
 * Self-limiting by design. The marker carries the time it was set and is
 * ignored once stale, so a tab closed mid-countdown and restored by the browser
 * cannot suppress the gate indefinitely. It is only ever allowed to delay an
 * explanation while an equivalent, more specific one is on screen — it gates no
 * access, and the server refuses every request either way.
 */

const KEY = 'meetifyy:deletion-countdown';

/** Comfortably longer than the 15s countdown, short enough to be harmless. */
const MAX_AGE_MS = 60 * 1000;

export function beginDeletionCountdown(storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(KEY, String(Date.now()));
  } catch {
    // Private mode. The gate simply takes over sooner, which is a worse
    // handoff but not a broken one — both screens say the same thing.
  }
}

export function endDeletionCountdown(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* nothing to clean up */
  }
}

export function isDeletionCountdownActive(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return false;
    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt)) return false;
    if (Date.now() - startedAt > MAX_AGE_MS) {
      storage.removeItem(KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
