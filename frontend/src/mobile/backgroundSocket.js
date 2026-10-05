/**
 * The realtime socket, released while the app is in the background.
 *
 * Capacitor keeps the WebView running when the app is backgrounded (its
 * `KeepRunning` defaults to true), so the socket stayed open and the presence
 * heartbeat kept firing every 25 s until Android froze the process: radio
 * wake-ups, a held server connection, and a user shown "online" with the app
 * closed. Chat apps release the connection in the background and catch up on
 * return; this does the same.
 *
 * After BACKGROUND_GRACE_MS hidden, the socket is disconnected cleanly — a
 * quick trip to the photo picker, a share sheet or a notification shade stays
 * connected. On return it reconnects; the connect handler already re-syncs
 * whatever arrived meanwhile.
 *
 * Installed app only. On the website a background tab is a normal way to use
 * it, and its unread badges should keep updating.
 */
import { useGlobalSocketStore } from '../shared/stores/useGlobalSocketStore';

export const BACKGROUND_GRACE_MS = 30_000;

export function installBackgroundSocket({
  doc = document,
  store = useGlobalSocketStore,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let timer = null;
  let released = null; // the socket this module disconnected, if any

  const onChange = () => {
    if (doc.visibilityState === 'hidden') {
      if (timer || released) return;
      timer = setTimer(() => {
        timer = null;
        const { socket } = store.getState();
        if (!socket?.connected) return;
        released = socket;
        try { socket.disconnect(); } catch { /* already closing */ }
      }, BACKGROUND_GRACE_MS);
      return;
    }

    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    // Reconnect only the socket we released, and only if it is still the
    // current one: a sign-out meanwhile replaced or removed it, and that one
    // must stay down.
    const { socket } = store.getState();
    if (released && socket === released && !socket.connected) {
      try { socket.connect(); } catch { /* reconnect loop takes over */ }
    }
    released = null;
  };

  doc.addEventListener('visibilitychange', onChange);
  return () => {
    doc.removeEventListener('visibilitychange', onChange);
    if (timer) clearTimer(timer);
  };
}
