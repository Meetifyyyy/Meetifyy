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
 *   - The ACCESS token is kept there too, with its expiry. It used to stay in
 *     memory only ("fewer copies of a secret"), which made EVERY cold start
 *     rotate the refresh token before anything could load: 1–2.5 s measured on
 *     a mid-range phone, and each rotation a window in which an app killed
 *     mid-request (swiped away, or reclaimed by an OS that pre-starts apps)
 *     lost the new refresh token and was signed out as a replay. Persisting it
 *     is what AppAuth, the reference OAuth client for Android, does with its
 *     whole auth state. It adds no exposure: anything that can read this
 *     Keystore entry can read the thirty-day refresh token beside it, which is
 *     strictly more powerful than a one-hour access token, and the access token
 *     is session-bound (`x-session-id`), so revoking the device still ends it.
 *     It is used at launch only with more than ACCESS_MIN_REMAINING_MS left.
 *
 * HOW A COLD START SIGNS BACK IN
 * It does not refresh here. `whenReady()` only loads what is on disk into
 * memory. With a usable access token the first request simply carries it; with
 * none, the transport renews first through its single-flight refresh, and a
 * stored token that turns out to be refused (revoked device) gets the usual
 * 401 → refresh-and-retry.
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
const ACCESS_KEY = 'mf.session.access';

/** A stored access token closer to expiry than this is not used at launch. */
const ACCESS_MIN_REMAINING_MS = 2 * 60 * 1000;

/**
 * When an access token expires, in epoch ms: from its own `exp` claim, else
 * from the response's `expiresIn`. Null when neither is known — such a token
 * is kept in memory but never written, because one with no knowable expiry
 * could not be judged at the next launch.
 */
function accessExpiry(token, expiresInSeconds, now) {
  try {
    const payload = token.split('.')[1];
    if (payload) {
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      if (typeof json?.exp === 'number') return json.exp * 1000;
    }
  } catch {
    // Not a readable JWT; fall through to the response's own lifetime.
  }
  return typeof expiresInSeconds === 'number' && expiresInSeconds > 0
    ? now + expiresInSeconds * 1000
    : null;
}

export function createCapacitorSessionSource({ secureStorage, now = () => Date.now() }) {
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
      const [storedRefresh, storedSessionId, storedAccess] = await Promise.all([
        secureStorage.get(REFRESH_KEY),
        secureStorage.get(SESSION_ID_KEY),
        secureStorage.get(ACCESS_KEY).catch(() => null),
      ]);

      if (!storedRefresh || !storedSessionId) return false;

      refreshToken = storedRefresh;
      sessionId = storedSessionId;

      // Still good for a while: the launch needs no rotation at all.
      try {
        const access = storedAccess ? JSON.parse(storedAccess) : null;
        if (
          typeof access?.token === 'string' &&
          typeof access?.exp === 'number' &&
          access.exp - now() > ACCESS_MIN_REMAINING_MS
        ) {
          accessToken = access.token;
        }
      } catch {
        // Unreadable: the transport renews as it always did.
      }
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

    // Both writes at once: they are independent Keystore entries, and a refresh
    // on the boot path waits for them before its replay goes out. Each value
    // still reaches memory only once ITS write has landed — so a rotated
    // refresh token that made it to disk is never shadowed in memory by the
    // retired one, whatever happens to the other write.
    const { refreshToken: nextRefresh, sessionId: nextSessionId, accessToken: nextAccess } = tokens;
    const exp = nextAccess ? accessExpiry(nextAccess, tokens.expiresIn, now()) : null;
    await Promise.all([
      nextRefresh &&
        secureStorage.set(REFRESH_KEY, nextRefresh).then(() => { refreshToken = nextRefresh; }),
      nextSessionId &&
        secureStorage.set(SESSION_ID_KEY, nextSessionId).then(() => { sessionId = nextSessionId; }),
      // Best-effort: a failed write only means the next launch renews.
      nextAccess && exp &&
        secureStorage.set(ACCESS_KEY, JSON.stringify({ token: nextAccess, exp })).catch(() => {}),
    ]);
    if (nextAccess) accessToken = nextAccess;
  }

  /** Signing out, or a session the server no longer recognises. */
  async function forget() {
    accessToken = '';
    refreshToken = '';
    sessionId = '';
    await secureStorage.remove(REFRESH_KEY);
    await secureStorage.remove(SESSION_ID_KEY);
    await secureStorage.remove(ACCESS_KEY).catch(() => {});
  }

  return {
    getToken: () => accessToken,
    getSessionId: () => sessionId,
    getRefreshToken: () => refreshToken,

    /**
     * This client keeps its own credential, so the transport must wait for
     * `whenReady()` before deciding it has none. See the contract.
     */
    holdsOwnCredential: () => true,

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

    /**
     * Resolves once the app is on screen.
     *
     * Some phones start apps in the background before anyone opens them (seen
     * on a Vivo as `preStart_up`) and kill them at will. A refresh-token
     * rotation in that state is a rotation nobody needs, and if the process is
     * killed between the server rotating and the new token reaching the
     * Keystore, the next launch presents a retired token and is signed out as
     * a replay. So the launch renewal waits until the app is visible.
     */
    whenForeground: () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const onChange = () => {
          if (document.visibilityState === 'hidden') return;
          document.removeEventListener('visibilitychange', onChange);
          resolve();
        };
        document.addEventListener('visibilitychange', onChange);
      });
    },

    adopt,
    forget,
  };
}

export default createCapacitorSessionSource;
