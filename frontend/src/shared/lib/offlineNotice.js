/**
 * The one "you're offline" notice, and the matching "back online".
 *
 * Rules, so a flaky connection never turns into a toast storm:
 *   - Offline at launch: said once, straight away.
 *   - Going offline during use: said once, after OFFLINE_SETTLE_MS, so a dip
 *     that recovers in a second says nothing at all.
 *   - "Back online" is said only if the offline notice was, and only once the
 *     connection has held for ONLINE_SETTLE_MS.
 *   - A connection that flaps inside either window cancels the pending notice.
 *     While an offline notice is still "open" (no Back online yet) another drop
 *     does not repeat it.
 *
 * A pure controller over injected `show` and timers, so it is testable without
 * a DOM; `OfflineNotice` wires it to the real signal and toast.
 */
export const OFFLINE_MESSAGE = "You're offline. Showing what was saved on this device.";
/** For a visitor who is not signed in: nothing of theirs is saved here. */
export const OFFLINE_MESSAGE_SIGNED_OUT = "You're offline. Some things won't load until you reconnect.";
export const ONLINE_MESSAGE = 'Back online';
export const OFFLINE_SETTLE_MS = 1500;
export const ONLINE_SETTLE_MS = 1000;

export function createOfflineNotice({
  show,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  offlineSettleMs = OFFLINE_SETTLE_MS,
  onlineSettleMs = ONLINE_SETTLE_MS,
}) {
  let timer = null;
  // The offline notice has been shown and "Back online" has not yet followed.
  let announcedOffline = false;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  return {
    /** The state at start-up: offline is announced at once. */
    start(online) {
      if (online) return;
      announcedOffline = true;
      show(OFFLINE_MESSAGE, 'offline');
    },
    /** A change in connectivity. */
    change(online) {
      cancel();
      if (online) {
        if (!announcedOffline) return;
        timer = setTimer(() => {
          timer = null;
          announcedOffline = false;
          show(ONLINE_MESSAGE, 'online');
        }, onlineSettleMs);
        return;
      }
      if (announcedOffline) return;
      timer = setTimer(() => {
        timer = null;
        announcedOffline = true;
        show(OFFLINE_MESSAGE, 'offline');
      }, offlineSettleMs);
    },
    dispose: cancel,
  };
}
