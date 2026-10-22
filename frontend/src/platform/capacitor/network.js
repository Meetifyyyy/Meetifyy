import { Network } from '@capacitor/network';

/** A second look this long after the system reported "not connected" (see `onlineFrom`). */
const RECHECK_AFTER_MS = 500;

/**
 * Whether a native status means "no network".
 *
 * `connected` is false on Android while the network is not VALIDATED: for a few
 * seconds after every Wi-Fi/cellular switch, and for good on a network that
 * blocks the system's own reachability probe, though traffic flows. So "not
 * connected" is believed only when there is no connection of any kind
 * (`connectionType: 'none'`); a connection that merely is not validated yet
 * counts as online, as `navigator.onLine` would say.
 */
function onlineFrom(status) {
  if (status?.connected === true) return true;
  // An older plugin that sends no type: the flag is all there is.
  if (typeof status?.connectionType !== 'string') return false;
  return status.connectionType !== 'none';
}

/**
 * The installed app's `NetworkStatus`: the system's own connectivity state
 * (Android ConnectivityManager), not the WebView's mirror of it in
 * `navigator.onLine`, which can lag or miss events across a background/resume.
 *
 * Needs the native `@capacitor/network` plugin, so it only works in a build
 * that includes it (AGENTS.md 6b). The module registers a plugin at import, so
 * it is loaded lazily from the mobile build only (AGENTS.md 6d); see
 * `shared/lib/networkStatus.js`.
 *
 * Every call can fail (plugin missing in an older shell, bridge not ready).
 * `isOnline` then rejects and the caller keeps its fallback; `onChange` never
 * throws and simply never fires.
 */
export function createCapacitorNetwork() {
  return {
    async isOnline() {
      return onlineFrom(await Network.getStatus());
    },

    onChange(listener) {
      let removed = false;
      let handle = null;
      let recheck = null;
      const emit = (status) => {
        if (!removed) listener(onlineFrom(status));
      };
      try {
        Promise.resolve(
          Network.addListener('networkStatusChange', (status) => {
            if (removed) return;
            emit(status);
            // Reported "not connected": the switch is usually finished within
            // moments, and a missed follow-up event would leave the app offline.
            // Look again; a newer event cancels the look.
            if (recheck !== null) clearTimeout(recheck);
            recheck = null;
            if (status?.connected !== true) {
              recheck = setTimeout(() => {
                recheck = null;
                Promise.resolve(Network.getStatus()).then(emit).catch(() => {});
              }, RECHECK_AFTER_MS);
            }
          }),
        )
          .then((h) => {
            // Unsubscribed before the native side answered.
            if (removed) void h?.remove?.();
            else handle = h;
          })
          .catch(() => {});
      } catch {
        // No plugin: never fires.
      }
      return () => {
        removed = true;
        if (recheck !== null) clearTimeout(recheck);
        recheck = null;
        void handle?.remove?.();
        handle = null;
      };
    },
  };
}
