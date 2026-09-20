/**
 * Where the web client's access token comes from.
 *
 * This is the whole of the transport's relationship with Supabase, gathered
 * into one file. The transport used to hold it inline: a module-scope
 * `supabase.auth.onAuthStateChange` subscription, a `getSession()` seed, and
 * three separate `isRecoveryTab()` guards scattered through the request path.
 * None of that is meaningful to a client that authenticates differently, and
 * all of it ran as a side effect of importing the API client.
 *
 * What the transport actually needs is three things — a token, permission to
 * send it, and something to await during signup — which is what `SessionSource`
 * in ../contracts.ts asks for.
 *
 * THE RECOVERY GUARD IS THE POINT
 * A password-recovery session is an ordinary session JWT; the backend cannot
 * tell it from a login, which is exactly why the client must. While a tab sits
 * on /reset-password the recovery credential would otherwise be the
 * Authorization header on every API call that tab makes. The guard lives here,
 * once, instead of at three call sites that each had to remember it.
 */

/**
 * @param {object} deps
 * @param {{auth: object}|null} deps.supabase      the app's auth client, or null when unconfigured
 * @param {() => boolean} deps.isRecoveryTab       latched for the lifetime of a recovery tab
 * @param {() => void} deps.clearRecoveryTab       called when the recovery session ends
 */
export function createWebSessionSource({ supabase, isRecoveryTab, clearRecoveryTab }) {
  let cachedToken = '';
  let hasSession = false;
  let initPromise = null;

  const cache = (session) => {
    if (isRecoveryTab()) {
      cachedToken = '';
      hasSession = false;
      return;
    }
    cachedToken = session?.access_token ?? '';
    hasSession = !!session;
  };

  if (supabase) {
    // Seed immediately from the stored session, and keep the promise so the two
    // signup-handover calls can await it — those are the only requests for which
    // the bearer token IS the credential.
    initPromise = supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        cache(session);
        return session;
      })
      .catch(() => null);

    supabase.auth.onAuthStateChange((event, session) => {
      // The reset page signs the recovery session out when it finishes, or when
      // the link turns out to be expired. That is the moment the tab stops being
      // a recovery tab — withholding tokens past it would break every request a
      // user makes after signing back in without reloading.
      if (event === 'SIGNED_OUT') clearRecoveryTab();
      cache(session);
    });
  }

  return {
    getToken: () => (isRecoveryTab() ? '' : cachedToken),
    isRecoveryCredential: () => isRecoveryTab(),
    whenReady: () => initPromise,

    /** True when a session has been seen. Used only to decide whether to ask. */
    hasSession: () => hasSession,

    /**
     * Drops the cached token. The cookies are the server's to clear; this is
     * the local shadow.
     */
    forget: () => {
      cachedToken = '';
      hasSession = false;
    },
  };
}
