/**
 * Where the installed app's credential lives.
 *
 * The web equivalent (`platform/web/sessionSource.js`) barely holds anything:
 * on the web the session is in HttpOnly cookies and the browser attaches them
 * without help. Inside a WebView it cannot — a browser refuses to store the
 * `SameSite=Strict` session cookies at all, because the app's origin and the
 * API are different sites — so this client holds the credential itself and
 * sends it as a bearer token.
 *
 * WHAT IS KEPT WHERE, AND WHY THE SPLIT
 *
 *   - The REFRESH token and the SESSION ID go to Keychain/Keystore. The refresh
 *     token is the long-lived credential (thirty days) and is the thing worth
 *     protecting; the session id travels with it because a token without its id
 *     is useless — the API refuses a bearer that cannot name its session.
 *
 *   - The ACCESS token stays in memory ONLY. It lives an hour, it is replaced
 *     on every refresh, and writing it to disk would add a second copy of a
 *     credential for no benefit: a cold start can always mint a fresh one from
 *     the refresh token. Fewer copies of a secret is the whole design.
 *
 * HOW A COLD START SIGNS BACK IN
 * It does not refresh here. `whenReady()` only loads what is on disk into
 * memory; the first request then goes out with no access token, comes back 401,
 * and the transport's existing single-flight refresh-and-retry does the rest.
 * Reusing that path rather than adding a second one keeps every refresh
 * single-flight — two independent renewals of the same rotating token look
 * exactly like a replay to the provider, which revokes the whole family and
 * signs the account out everywhere.
 *
 * The getters are SYNCHRONOUS because the transport calls them on the request
 * path and cannot await there. That is the reason the Keychain read happens
 * once, in `whenReady()`, instead of per request.
 */

const REFRESH_KEY = 'mf.session.refresh';
const SESSION_ID_KEY = 'mf.session.id';

export function createCapacitorSessionSource({ secureStorage }) {
  let accessToken = '';
  let refreshToken = '';
  let sessionId = '';
  let readyPromise = null;

  /**
   * Loads a stored session into memory. No network, no decisions.
   *
   * A failure ends as "signed out" rather than as an error: a Keychain entry
   * whose key is gone after a device restore is not an exceptional condition,
   * and the one thing that must not happen is an app that cannot reach its own
   * login screen because reading a credential it does not have threw.
   */
  async function restore() {
    try {
      const [storedRefresh, storedSessionId] = await Promise.all([
        secureStorage.get(REFRESH_KEY),
        secureStorage.get(SESSION_ID_KEY),
      ]);

      if (!storedRefresh || !storedSessionId) return false;

      refreshToken = storedRefresh;
      sessionId = storedSessionId;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Takes the tokens from a login, a signup handover or a refresh.
   *
   * Writes to the Keychain before updating memory, so a write that fails leaves
   * the app signed out rather than appearing signed in until the next launch —
   * a state where someone sees their feed, closes the app, and is silently back
   * at the login screen with no explanation.
   *
   * Partial payloads are normal and must not clear what they omit: a refresh
   * returns a new access token and a rotated refresh token, while other
   * responses carry only some of the three.
   */
  async function adopt(tokens) {
    if (!tokens) return;

    if (tokens.refreshToken) {
      await secureStorage.set(REFRESH_KEY, tokens.refreshToken);
      refreshToken = tokens.refreshToken;
    }
    if (tokens.sessionId) {
      await secureStorage.set(SESSION_ID_KEY, tokens.sessionId);
      sessionId = tokens.sessionId;
    }
    if (tokens.accessToken) accessToken = tokens.accessToken;
  }

  /** Signing out, or a session the server no longer recognises. */
  async function forget() {
    accessToken = '';
    refreshToken = '';
    sessionId = '';
    await secureStorage.remove(REFRESH_KEY);
    await secureStorage.remove(SESSION_ID_KEY);
  }

  return {
    getToken: () => accessToken,
    getSessionId: () => sessionId,
    getRefreshToken: () => refreshToken,

    /**
     * Always false. A password-recovery session is a web concept: it exists
     * because a recovery link opens a tab holding a provider session that must
     * never be sent to the API. The app has no such tab and no such link
     * handling, so there is no recovery credential it could be holding.
     */
    isRecoveryCredential: () => false,

    whenReady: () => {
      if (!readyPromise) readyPromise = restore();
      return readyPromise;
    },

    adopt,
    forget,
  };
}

export default createCapacitorSessionSource;
