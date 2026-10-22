/**
 * The browser's `NetworkStatus` (platform/contracts.ts): `navigator.onLine`
 * plus the `online` / `offline` events.
 *
 * `false` is reliable (no connection at all); `true` only means a connection
 * exists, not that the API is reachable. An environment with no flag counts as
 * online. `readNavigatorOnline` is the synchronous read the shared
 * `networkStatus` module also uses as its fallback, so there is one definition.
 */
export function readNavigatorOnline() {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

export function createWebNetwork() {
  return {
    async isOnline() {
      return readNavigatorOnline();
    },

    onChange(listener) {
      if (typeof window === 'undefined') return () => {};
      const onOnline = () => listener(true);
      const onOffline = () => listener(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    },
  };
}
