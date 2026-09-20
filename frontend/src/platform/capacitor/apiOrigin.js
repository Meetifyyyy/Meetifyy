/**
 * Where the API is, from inside a native shell.
 *
 * This is the whole of blocker B1's fix, and it is short because the web
 * implementation's complexity is entirely about a question this one does not
 * have to ask.
 *
 * THE BUG IT REPLACES
 * The web implementation decides where the backend is by inspecting
 * `window.location.hostname`: a page served from localhost, a LAN address or a
 * Tailscale address talks to a backend on that same host, which is what makes
 * testing from a phone on the same Wi-Fi work.
 *
 * Inside a Capacitor WebView that reasoning is not merely unnecessary, it is
 * wrong. The page origin is `https://localhost` on Android and
 * `capacitor://localhost` on iOS, so the hostname is literally `localhost` and
 * the predicate says "this client is on the local network". A native build
 * using the web implementation would therefore resolve its API to
 * `https://localhost:4000` — or, on iOS, `capacitor://localhost:4000`, since
 * the protocol is taken from the page too. Neither exists. The symptom is not
 * a subtle one, but it reads as "the backend is down" rather than as a
 * client-side bug.
 *
 * The same mistake was in `getMediaUrl`: every stored media URL naming a
 * private origin would have been rewritten to `capacitor://localhost:4000/...`
 * and every one of those images would have failed to load. That is why
 * `privateMediaTarget()` below answers unconditionally.
 *
 * SO: NO PROBING. A bundled app has exactly one place its API can be — the one
 * it was built with — and asking the page where it is can only produce a wrong
 * answer.
 *
 * Deliberately imports nothing from `@capacitor/*`. There is no device
 * question here, only a configuration one, and a file that needs no plugin
 * should not take one.
 */

/**
 * @param {object} deps
 * @param {object} deps.config  the app's validated config object (`@config`)
 */
export function createCapacitorApiOrigin({ config }) {
  const configured = config.api.baseUrl;

  if (!configured) {
    /**
     * Loud, and at construction rather than at the first request.
     *
     * On web an empty API origin means "same origin", which is a working
     * configuration — the dev-server proxy, or a deployment serving the API
     * under its own domain. A bundled app has no same origin to fall back to:
     * requests would go to the WebView's own local server, which serves static
     * files and knows nothing about `/api`. Every call would fail with a
     * confusing 404 from a server nobody realised was answering.
     */
    throw new Error(
      'VITE_API_URL is required for a native build: a bundled app has no same-origin API to fall back to. ' +
        'Set it in the mobile env file for this environment.',
    );
  }

  const baseUrl = () => configured;

  /**
   * Realtime follows the API, and there is no failover to move it to.
   *
   * The same origin as the API rather than a separate `VITE_WS_URL`, because
   * that variable does not exist yet and the socket store currently derives its
   * URL from `getBackendUrl()` too. Splitting them is a real option later — a
   * deployment could put realtime behind a different host — but inventing the
   * config here before anything reads it would be a guess.
   */
  const socketUrl = () => configured;

  /**
   * Null, always.
   *
   * The web client can fall back to a same-origin proxy prefix when a filtered
   * network blocklists the API's hostname but not the app's own. A native app
   * has no second origin serving the same content, so there is nothing to fall
   * back to and pretending otherwise would send requests to the local file
   * server.
   */
  const fallbackBaseUrl = () => null;

  /** For the same reason. */
  const canFailOver = () => false;

  /**
   * A private-origin media URL always goes to the configured API.
   *
   * Never `{ kind: 'local' }`: "this client is on that network" is a statement
   * about a browser tab on somebody's laptop, and it is never true of a shipped
   * app even though the page origin says `localhost`.
   */
  const privateMediaTarget = () => ({ kind: 'api' });

  return { baseUrl, socketUrl, fallbackBaseUrl, privateMediaTarget, canFailOver };
}
