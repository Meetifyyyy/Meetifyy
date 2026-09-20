/**
 * The last ETag seen for each URL, so a GET can send `If-None-Match` and the
 * server can answer 304 instead of re-sending a body that has not changed.
 *
 * Portable because the only thing it needs is somewhere to put strings, and
 * that is supplied. The web passes `sessionStorage`; a native client passes an
 * in-memory map hydrated at startup — see `SyncKeyValueStore` in
 * platform/contracts.ts for why this must not be async.
 *
 * Keys are prefixed rather than namespaced into their own store, because the
 * store handed in is shared with other short-lived values and the prefix is
 * what lets `clear()` drop exactly these and nothing else.
 */

export const ETAG_PREFIX = '__etag__';

/**
 * @param {object} deps
 * @param {{get,set,remove,clearPrefixed?}} deps.store  a SyncKeyValueStore
 */
export function createEtagCache({ store }) {
  return {
    /** The stored ETag for a URL, or '' — never null, so callers can send it directly. */
    get(url) {
      return store.get(ETAG_PREFIX + url) || '';
    },

    /**
     * Records an ETag. A falsy value is ignored rather than stored: a response
     * without one means "no validator", and writing an empty string would make
     * the next request send `If-None-Match: `, which is not the same thing.
     */
    set(url, etag) {
      if (!etag) return;
      store.set(ETAG_PREFIX + url, etag);
    },

    /**
     * Forgets a URL's validator.
     *
     * Called when a cached response turns out to be unusable. Keeping a
     * validator whose body we can no longer produce means the server answers
     * 304 and the client has nothing to show for it — an empty screen that
     * looks like a loading bug and survives every reload until storage is
     * cleared.
     */
    drop(url) {
      store.remove(ETAG_PREFIX + url);
    },

    /** Every validator this cache owns. Part of the logout purge. */
    clear() {
      store.clearPrefixed?.(ETAG_PREFIX);
    },
  };
}
