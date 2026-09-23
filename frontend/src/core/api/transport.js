import { SAFE_METHODS, isBearerPath, isPublicPath } from './paths';

/**
 * The HTTP transport: how a request is made, and what happens when it fails.
 *
 * Everything here is the same for every client — the request path, conditional
 * requests, in-flight deduplication, the 401 refresh-and-retry with its
 * single-flight guard, and the origin failover. None of it depends on running
 * in a browser tab, which is what lets it live in core/.
 *
 * WHAT IT REFUSES TO KNOW
 * Where the API is, where to put a string, what a session is, and what any
 * particular error code means. All four arrive as arguments. The browser's
 * answers live in platform/web/; a native client supplies its own and nothing
 * in this file changes.
 *
 * A FACTORY, NOT A MODULE OF SINGLETONS
 * The token cache, the CSRF token, the failover flag and the in-flight map are
 * per-transport state. Two clients in one process — which is what a test
 * harness is, and what web and mobile will be — must not share them, and the
 * only way to guarantee that is to create the state per call rather than at
 * module scope.
 *
 * @param {object} deps
 * @param {object} deps.apiOrigin     ApiOrigin: baseUrl, fallbackBaseUrl, canFailOver
 * @param {object} deps.session       SessionSource: getToken, isRecoveryCredential, whenReady, forget
 * @param {object} deps.cookies       readCsrf(); '' where a client has no cookies
 * @param {object} deps.localStore    SyncKeyValueStore, durable
 * @param {object} deps.sessionStore  SyncKeyValueStore, per-session
 * @param {object} deps.etags         from core/api/etagCache
 * @param {object} deps.hooks         TransportHooks: onApiErrorCode, onUnauthorized, onOriginChanged
 */
export function createTransport({
  apiOrigin,
  session,
  cookies,
  localStore,
  sessionStore,
  etags,
  hooks,
}) {
  /**
   * The CSRF token the server set alongside the session cookies.
   *
   * Readable on purpose — it is not a credential on its own, and the whole
   * double-submit scheme depends on the page being able to echo it back. The
   * session cookies beside it are HttpOnly and this cannot reach them.
   *
   * Only ever a FALLBACK now. `document.cookie` shows a page the cookies of its
   * own document, and the API is routinely on a different hostname — so unless
   * the cookie is explicitly scoped to the registrable domain, this returns an
   * empty string on a perfectly healthy session. Every response that issues the
   * cookies also hands the token back in its body, which `rememberCsrfToken`
   * stores, and that is what the header is built from.
   */
  function readCsrfCookie() {
    return cookies.readCsrf();
  }

  /**
   * The CSRF token this tab holds, taken from the response that issued it.
   *
   * Kept in memory and nowhere else. It is scoped to the cookies the browser is
   * already carrying, dies with the tab, and is re-learned on the next boot from
   * `GET /api/auth/session` — so there is nothing to persist and nothing for a
   * later reader to find.
   */
  let _csrfToken = '';

  /**
   * Records the token a session-issuing response returned.
   *
   * Called from login, from session adoption, from a cookie refresh and from the
   * boot probe — every response that writes `mf_csrf` also names it in its body,
   * precisely so the page does not have to be able to read the cookie.
   */
  function rememberCsrfToken(token) {
    if (typeof token === 'string' && token) _csrfToken = token;
  }

  /** Dropped on sign-out with everything else the session owned. */
  function forgetCsrfToken() {
    _csrfToken = '';
  }

  /** What goes in `x-csrf-token`: what we were told, or what we can read. */
  function csrfHeaderValue() {
    return _csrfToken || readCsrfCookie();
  }


  /**
   * Drops everything in this tab that belonged to the session.
   *
   * Called when the server has told us the session is over. The cookies are the
   * server's to clear — it does that on the logout and refresh routes — so what
   * is left here is the local shadow: the cached profile, the CSRF token, and the
   * per-user lists that must not survive into whoever signs in next on this
   * machine.
   */
  function clearLocalAuthState() {
    session.forget();
    forgetCsrfToken();
    [
      'loggedIn',
      'currentUser',
      'meetifyy_recent_searches',
      'meetify_muted_communities',
      'read_invitations',
      'meetify_following_list',
      'meetify_followers_list',
    ].forEach((key) => localStore.remove(key));
    etags.clear();
  }

  /**
   * Whether this browser looks like it is carrying a session worth restoring.
   *
   * A hint, never a decision — the server authorizes, and a wrong answer here
   * costs at most one round trip. It exists so a first-time visitor and a
   * signed-out one do not spend a request being told 401 on every page load.
   *
   * Deliberately NOT `readCsrfCookie()` on its own, which is what it used to be.
   * That cookie is invisible to the page whenever the API is host-only on
   * another hostname, so on those deployments the answer was always "no session"
   * and a valid cookie session was never restored — the app showed the landing
   * page to signed-in users on every single reload. `loggedIn` is a local marker
   * this app writes when a session is established and clears when one ends; it
   * proves nothing, which is fine, because it is only deciding whether to ask.
   */
  function mayHaveCookieSession() {
    /**
     * A client that keeps its own credential answers for itself.
     *
     * The other two signals are cookie-shaped, and the installed app has no
     * cookies at all — a browser refuses to store the SameSite=Strict session
     * cookies in its WebView. Without this line the boot gate concluded "no
     * session" on every launch and signed a returning user out before it had
     * looked in the Keychain.
     *
     * Only meaningful once `whenReady()` has resolved, which is why the boot
     * awaits it first.
     */
    if (session.getRefreshToken?.()) return true;
    if (readCsrfCookie()) return true;
    return localStore.get('loggedIn') === 'true';
  }


  // ── API origin failover ──────────────────────────────────────────────────────
  // The app and the API are typically served from different hostnames. Campus and
  // other filtered networks routinely blocklist a shared PaaS wildcard domain
  // without blocking the app's own domain, which leaves the shell loading and
  // every request failing at the TCP level.
  //
  // The proxy prefix (a host rewrite that forwards to the same backend from the
  // app's own origin) is reachable wherever the app itself is. We do NOT route
  // through it by default — that would put all API traffic through the edge for
  // everyone. It is armed only after a real connection-level failure, and only
  // once the proxy has been confirmed to work, then remembered for the session.
  const FAILOVER_FLAG = 'meetifyy_api_failover';

  let _useProxyOrigin = sessionStore.get(FAILOVER_FLAG) === '1';

  const isApiFailoverActive = () => _useProxyOrigin;

  function sameOriginProxyBase() {
    return apiOrigin.fallbackBaseUrl() || '';
  }

  /**
   * True when the same-origin proxy is a meaningful alternative: we are in a
   * browser, on a real deployment, and the API currently lives on a different
   * host. On localhost the API is already reachable or genuinely down, and there
   * is no proxy to fall back to.
   */
  function canFailOver() {
    return apiOrigin.canFailOver();
  }

  /**
   * Confirms the proxy can actually reach the backend before committing the
   * session to it — otherwise a network that blocks everything would flip the
   * flag and make every later request take two failed round-trips instead of one.
   */
  let _failoverProbe = null;
  function activateFailover() {
    if (_useProxyOrigin) return Promise.resolve(true);
    if (_failoverProbe) return _failoverProbe;

    _failoverProbe = (async () => {
      try {
        const res = await fetch(`${sameOriginProxyBase()}/health`, { cache: 'no-store' });
        if (!res.ok) return false;
        _useProxyOrigin = true;
        sessionStore.set(FAILOVER_FLAG, '1');
        // Realtime has to move with it; the socket store reads this event rather
        // than polling the flag.
        hooks.onOriginChanged?.();
        return true;
      } catch {
        return false;
      } finally {
        _failoverProbe = null;
      }
    })();

    return _failoverProbe;
  }

  /**
   * Where the API is.
   *
   * The browser-specific reasoning — is this page on a private network, may an
   * http origin be upgraded, is there a same-origin proxy — moved to
   * `platform/web/apiOrigin.js` so that a client running somewhere other than a
   * browser tab can answer the same questions differently. Inside a Capacitor
   * WebView the page hostname is `localhost`, which the old inline version read
   * as "on the local network"; a native implementation returns the configured
   * origin and probes nothing.
   *
   * The failover state machine stays here: it is transport behaviour, not a
   * property of the platform.
   */
  const directBackendUrl = () => apiOrigin.baseUrl();

  const getBackendUrl = () => (_useProxyOrigin ? sameOriginProxyBase() : directBackendUrl());
  /**
   * The bearer token, when this tab happens to hold one.
   *
   * Normally it holds none: the credential is an HttpOnly cookie. The one window
   * where a token exists in JavaScript is between `verifyOtp` confirming a signup
   * code and `POST /api/auth/session/adopt` converting that provider session into
   * cookies — and the header is what authenticates the adoption call itself.
   *
   * The localStorage sweep that used to live here is gone. It walked every `sb-*`
   * key looking for an access token and adopted the first one it found, which
   * re-introduced exactly what memory-only session storage was added to remove:
   * a credential read off disk, with no check that it belonged to the person
   * currently using the browser. On a shared machine it was a path for one
   * account's leftover token to authenticate the next account's session. It also
   * walked around the recovery guard, since an empty cache is precisely the state
   * that reached it.
   */
  function getToken() {
    return session.getToken();
  }

  // ── In-flight request deduplication ─────────────────────────────────────────
  // Prevents duplicate network calls when multiple components request the same
  // URL before the first response resolves (common on route mount).
  const _inflight = new Map();

  // ── ETag store ───────────────────────────────────────────────────────────────
  // Stores the last ETag per URL in the injected cache so If-None-Match can be
  // sent, enabling 304 Not Modified responses when data hasn't changed. Where
  // that cache actually puts the string is the platform's business: sessionStorage
  // on web, an in-memory map hydrated at startup on a device.
  const getStoredEtag = (url) => etags.get(url);
  const storeEtag = (url, etag) => etags.set(url, etag);
  const dropEtag = (url) => etags.drop(url);

  let _refreshPromise = null;

  /**
   * Renews the session cookies, once, no matter how many callers ask.
   *
   * This replaces `supabase.auth.refreshSession()`, which was the wrong thing in
   * two separate ways.
   *
   * It refreshed the PROVIDER session held in this tab's memory, and did nothing
   * at all to the cookies — so the credential the server actually authenticates
   * with was never renewed. The access cookie expired on its own, every request
   * after that came back 401, and the app signed the user out with a perfectly
   * good session sitting in the database. Nothing in the app called
   * `/api/auth/session/refresh`; the endpoint existed and had no callers.
   *
   * And it spent a refresh token the SERVER also holds. Supabase retires a
   * refresh token the instant it is used, so a refresh here quietly invalidated
   * the copy sealed into the session row — and presenting a retired token trips
   * the provider's reuse detection, which revokes the whole family and signs the
   * account out everywhere. Custody of that token now belongs to the server
   * alone, and this asks the server to use it.
   *
   * Single-flight because the alternative is a stampede: a route mount fires a
   * dozen requests at once, they all 401 together, and a dozen simultaneous
   * rotations of the same token is indistinguishable from a replay. Everyone
   * waits on the first one.
   */
  function refreshCookieSession() {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      try {
        // A recovery tab holds a one-time credential for the reset page and no
        // session of its own. Rotating anything on its behalf is meaningless.
        if (session.isRecoveryCredential()) return false;

        const url = `${getBackendUrl().replace(/\/+$/, '')}/api/auth/session/refresh`;

        /**
         * The refresh token travels in the BODY for a client that holds one,
         * and nowhere at all for a client that does not.
         *
         * On web `getRefreshToken` is absent: the refresh token is an HttpOnly
         * cookie scoped to this very path, the browser attaches it, and script
         * has never been able to read it — which is the entire point of putting
         * it there. The server keeps that rule by reading the body only when
         * there is no refresh cookie and the caller is the native origin, so
         * this cannot become a way for a web page to opt into the body path.
         */
        const storedRefresh = session.getRefreshToken?.();
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: storedRefresh
            ? JSON.stringify({ refreshToken: storedRefresh })
            : undefined,
        });

        /**
         * Three outcomes, not two — and the difference is who gets signed out.
         *
         * Only 401 is the server saying the session is over. Everything else is
         * the server failing to answer: a 429 because the rate limiter lost Redis
         * and fails closed, a 502 mid-deploy, a gateway timeout. Treating those
         * as "expired" ends a perfectly good session, and ends it for EVERYONE at
         * once, because a Redis outage hits every refresh simultaneously and
         * every tab renews on roughly the same hourly cadence.
         *
         * That failure mode is new. Nothing called this endpoint before, so its
         * `onRedisFailure: 'closed'` policy was inert; making the client actually
         * use it is what turned a cache outage into a mass sign-out, and this is
         * what takes it back out.
         */
        if (res.status === 401) return 'expired';
        if (!res.ok) return 'unavailable';

        const body = await res.json().catch(() => null);
        rememberCsrfToken(body?.csrfToken);

        /**
         * A rotating credential must be stored before the retry goes out.
         * The server has already retired the token just presented, so a client
         * that keeps the old one has nothing usable left — the next refresh
         * would present a retired token, which is indistinguishable from a
         * replay and revokes the whole family.
         *
         * Absent on web, where there is nothing to store.
         */
        if (session.adopt) await session.adopt(body);

        return 'renewed';
      } catch {
        // Offline, blocked, timed out. Says nothing about the session.
        return 'unavailable';
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  }

  /**
   * @param {string} [bearer]
   *   A credential for THIS request only, in place of the session source's.
   *
   *   It exists for the signup handover. `verifyOtp` answers with a provider
   *   session, and the two calls that follow must be authenticated with exactly
   *   that session. Leaving them to the session source to discover made the
   *   handover depend on each platform noticing the new session on its own: the
   *   web source happened to, through its provider subscription; the installed
   *   app's source never could, since it only holds what it is handed. So the
   *   app sent both calls with no credential, the account was verified but
   *   never created or signed in, and the next authenticated request sent the
   *   user back to the opening screen.
   *
   *   The caller holds the credential, so the caller passes it. A 401 on such a
   *   request is about that credential, not the ambient session, so it neither
   *   triggers a refresh nor tears the ambient session down.
   */
  async function request(method, path, body, signal, timeoutMs, bearer) {
    // Session seeding used to be awaited here, because the credential lived in
    // the provider client and a request issued before it had loaded would have
    // gone out unauthenticated. The credential is a cookie now: the browser
    // attaches it with no help from this code and with nothing to wait for, so
    // every request that is not part of signup's brief bearer window is blocked
    // on a promise that can no longer change its outcome.
    //
    // Still awaited for the paths that genuinely need the bearer token — the
    // session-adoption call at the end of signup and the profile write beside it
    // — because for those the header IS the credential.
    /**
     * Wait for the credential to be in hand before asking.
     *
     * Two different clients need this for two different reasons:
     *
     *   • Signup's brief bearer window, on web: the handover calls are
     *     authenticated by the header, so the header IS the credential.
     *
     *   • The installed app, always: its credential lives in the Keychain and
     *     is read asynchronously at boot. Without this the first request went
     *     out with no token AND the refresh that followed found none either,
     *     because `whenReady()` had not run — so a perfectly good session was
     *     reported expired and the user was signed out on every launch.
     *
     * Web pays nothing: `holdsOwnCredential` is false there, its session lives
     * in a cookie the browser attaches on its own, and this stays scoped to the
     * handful of signup paths it always covered.
     */
    const selfCustody = session.holdsOwnCredential?.() === true;
    const explicitCredential = typeof bearer === 'string' && bearer !== '';
    if (
      !explicitCredential &&
      !session.getToken() &&
      session.whenReady() &&
      (selfCustody || isBearerPath(path))
    ) {
      await session.whenReady();
    }

    const token = explicitCredential ? bearer : getToken(); // synchronous

    // No bearer token is no longer fatal.
    //
    // Authentication moved to an HttpOnly cookie, which this code cannot see by
    // design — so "no token in JS" is the normal signed-in state, not an error.
    // Refusing here would have made every request fail the moment tokens stopped
    // being kept where scripts can read them. The server decides; a request with
    // neither credential simply comes back 401.

    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;

      /**
       * The session the token belongs to.
       *
       * Sent only beside a bearer token, and only by a client that holds one —
       * `getSessionId` is absent on web, where the session id is an HttpOnly
       * cookie the browser attaches itself and script cannot read.
       *
       * This is not decoration. The API refuses a bearer token on ordinary
       * routes precisely because a bare token names no session, so the checks
       * behind "sign out this device", "sign out everywhere" and
       * password-change revocation have nothing to look up. Naming the session
       * is what makes the native credential revocable, and therefore what makes
       * it acceptable at all.
       */
      // Never beside an explicit credential: the stored id names the stored
      // session, which is not the one this token belongs to.
      const nativeSessionId = explicitCredential ? '' : session.getSessionId?.();
      if (nativeSessionId) headers['x-session-id'] = nativeSessionId;
    }

    // Send ETag for GET requests — enables 304 Not Modified on unchanged data
    if (method === 'GET') {
      const baseUrl = getBackendUrl();
      const cleanUrl = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
      const storedEtag = getStoredEtag(cleanUrl);
      if (storedEtag) headers['If-None-Match'] = storedEtag;
    }

    // GET: use browser default caching (backend sends Cache-Control).
    // POST/PATCH/PUT/DELETE: always bypass cache — never stale mutation responses.
    // `include`, not `same-origin`: the app and the API are different origins in
    // production, and this is what carries the HttpOnly session cookie. The
    // backend allows credentials for exactly the configured origins.
    const options = {
      method,
      headers,
      credentials: 'include',
      cache: method === 'GET' ? 'default' : 'no-store',
    };

    // Double-submit CSRF. The cookie ride-along is readable on purpose and is
    // worthless without the HttpOnly cookie beside it; echoing it in a header is
    // what proves the request came from our own page rather than from a form on
    // someone else's site that the browser happened to attach cookies to.
    if (!SAFE_METHODS.has(method)) {
      const csrf = csrfHeaderValue();
      if (csrf) headers['x-csrf-token'] = csrf;
    }
    /**
     * Whether a 401 from this path means anything about the session.
     *
     * It does not for the routes below, which are reachable signed out by
     * design — a shared post, the legal documents, the help centre. A 401 there
     * is about the resource, and treating it as a dead session would sign a
     * perfectly valid user out for opening somebody's post link. Rides along on
     * the options object like `timeoutMs`; `fetch` ignores what it does not know.
     */
    options.publicPath = isPublicPath(path);
    // Same reasoning for a request carrying its own credential: its 401 says
    // nothing about the ambient session. See `bearer` above.
    options.explicitCredential = explicitCredential;

    if (signal) options.signal = signal;
    // Per-call deadline, for the few mutations whose UI holds a visible spinner
    // and where the 30s default is far longer than the user will wait before
    // deciding the app is broken. Omitted, `_doFetch` applies that default.
    if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
    if (body !== undefined) {
      if (body instanceof FormData) {
        delete headers['Content-Type'];
        options.body = body;
      } else {
        options.body = JSON.stringify(body);
      }
    }

    // Rebuilt rather than captured, so a retry after failover targets the new
    // origin instead of the one that just failed.
    const buildUrl = () => `${getBackendUrl().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    const cleanUrl = buildUrl();

    const send = async () => {
      try {
        return await _doFetch(buildUrl(), options);
      } catch (err) {
        // A TypeError out of fetch is the unambiguous "could not connect" signal:
        // DNS failure, connection reset, blocked host. An HTTP error status is a
        // response and never lands here, so this cannot mask a real 4xx/5xx.
        const isConnectionFailure = err instanceof TypeError;
        if (!isConnectionFailure || isApiFailoverActive() || !canFailOver()) throw err;
        const proxied = await activateFailover();
        if (!proxied) throw err;
        return _doFetch(buildUrl(), options);
      }
    };

    // In-flight deduplication: GET requests only — share one promise per URL
    if (method === 'GET') {
      const inflightKey = cleanUrl;
      if (_inflight.has(inflightKey)) {
        return _inflight.get(inflightKey);
      }
      const promise = send().finally(() => _inflight.delete(inflightKey));
      _inflight.set(inflightKey, promise);
      return promise;
    }

    return send();
  }

  // Requests had no timeout at all: if the API stalled (server down, mid-restart,
  // dead connection) the promise never settled, so every screen sat on its loading
  // state indefinitely with no error and no way to retry.
  const DEFAULT_TIMEOUT_MS = 30_000;
  const UPLOAD_TIMEOUT_MS = 5 * 60_000; // large media needs a far longer window

  async function _doFetch(cleanUrl, options, isRetry = false) {
    const isUpload = typeof FormData !== 'undefined' && options?.body instanceof FormData;
    const timeoutMs = options?.timeoutMs ?? (isUpload ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

    // A caller-supplied signal means the caller owns cancellation (e.g. the media
    // pipeline) — don't layer our own abort on top of it.
    let signal = options?.signal;
    let timeoutId;
    if (!signal && timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      signal = controller.signal;
    }

    let res;
    try {
      res = await fetch(cleanUrl, { ...options, signal });
    } catch (err) {
      if (err?.name === 'AbortError' && !options?.signal) {
        throw new Error('Request timed out. Please check your connection and try again.');
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    /**
     * Remember the ETag, but only where a conditional request can actually pay.
     *
     * `If-None-Match` is worth sending only when the browser's own HTTP cache
     * still holds the body — this store keeps tokens, not bodies, so a 304 it
     * provokes on its own is a wasted round trip and nothing more. A response
     * marked `no-store` is never held by that cache, so a conditional request for
     * one is guaranteed to come back 304 with an empty body, every time.
     *
     * The session probe and every other auth route are `no-store`, which is how
     * an optimisation came to sit in front of the boot path and answer it with an
     * unparseable response.
     */
    if (options.method === 'GET' && res.ok) {
      const etag = res.headers.get('ETag');
      const cacheable = !/no-store/i.test(res.headers.get('Cache-Control') || '');
      if (etag && cacheable) storeEtag(cleanUrl, etag);
      else if (!cacheable) dropEtag(cleanUrl);
    }

    /**
     * "Not Modified" — which this client has no way to honour.
     *
     * The ETag store keeps tokens and not bodies, so there is nothing here to
     * serve a 304 from. The conditional request is satisfiable only by the
     * browser's own HTTP cache, and only when that cache still holds the entry;
     * when it does not, the 304 arrives with an empty body and fell straight
     * through to the `!res.ok` branch below as `API error 304`.
     *
     * That is invisible until the app and the API share an origin — cross-origin,
     * `ETag` is not an exposed response header, so nothing is ever stored and no
     * conditional request is ever made. Same-origin (a deployment serving the API
     * under its own domain, or this client's own proxy failover) it fires on the
     * SECOND request for any URL in the tab, which for the session probe means
     * the second page load: the boot would have read a thrown error as "no
     * session" and signed the user out on reload. Exactly the class of bug this
     * whole change exists to remove.
     *
     * Dropping the token and re-asking unconditionally is the honest recovery:
     * one extra round trip, on a request that was only ever an optimisation.
     */
    if (res.status === 304 && options.headers?.['If-None-Match']) {
      dropEtag(cleanUrl);
      const { 'If-None-Match': _dropped, ...headers } = options.headers;
      return _doFetch(cleanUrl, { ...options, headers }, isRetry);
    }

    if (res.status === 401 && !isRetry && !options.publicPath && !options.explicitCredential) {
      // The access cookie is short-lived by design, so a 401 here is the ordinary
      // end of its life far more often than it is a dead session. Ask the server
      // to rotate — it holds the refresh token — and replay the request once.
      //
      // The retry carries no new Authorization header, and that is deliberate:
      // the credential is the cookie the server just rewrote, and `credentials:
      // 'include'` is what sends it.
      const outcome = await refreshCookieSession();
      if (outcome === 'renewed') {
        const retryHeaders = { ...options.headers };
        if (options.method && !SAFE_METHODS.has(options.method)) {
          const csrf = csrfHeaderValue();
          if (csrf) retryHeaders['x-csrf-token'] = csrf;
        }

        /**
         * A self-custody client must replay with whatever the refresh just
         * minted — ADDING the header when the request had none.
         *
         * The note above is true for a cookie: the server rewrote it, and
         * `credentials: 'include'` sends whatever is current, so reusing the
         * original headers is right. For the installed app the credential is a
         * header, so the retry has to be rebuilt.
         *
         * Gated on the CLIENT, not on the original request having carried a
         * header. That distinction is the whole bug: on a cold start the access
         * token is empty — it is never written to disk, by design — so the
         * first request goes out with no Authorization at all, and only the
         * refresh token has been restored. A version of this that merely
         * replaced an existing header left the replay uncredentialed, it 401'd
         * again, and because that arrives as `isRetry` it fell through as a
         * hard error. The stored session was perfectly good; the app asked for
         * a fresh sign-in on every single launch.
         *
         * Web is untouched: `holdsOwnCredential` is absent there, its session
         * is a cookie, and adding a bearer header would be wrong.
         */
        if (session.holdsOwnCredential?.()) {
          const renewed = session.getToken?.();
          if (renewed) {
            retryHeaders['Authorization'] = `Bearer ${renewed}`;
            const renewedSessionId = session.getSessionId?.();
            if (renewedSessionId) retryHeaders['x-session-id'] = renewedSessionId;
          }
        }

        return _doFetch(cleanUrl, { ...options, headers: retryHeaders }, true);
      }

      /**
       * The rotation was REFUSED (401), so the session is genuinely over: revoked
       * from another device, expired, or the provider retired it.
       *
       * `unavailable` deliberately does not land here. Nothing was learned about
       * the session in that case, so the original 401 simply falls through and
       * surfaces as an ordinary error for this one request, and the user stays
       * signed in.
       *
       * What this does NOT do any more, and why:
       *
       *   • It does not call `supabase.auth.signOut()`. That defaults to GLOBAL
       *     scope, so one stale 401 in one background request signed the account
       *     out of every device it was open on — including the one the user was
       *     sitting at, and including devices belonging to a session that was
       *     perfectly healthy.
       *
       *   • It does not assign `window.location.href`. A full document load threw
       *     away everything unsaved on the page and raced the router, which was
       *     already re-rendering the signed-out tree from the same state change.
       *     Announcing it is enough: AuthContext clears the session and the route
       *     gates render the public app, in the same tab, without a reload.
       */
      if (outcome === 'expired') {
        clearLocalAuthState();
        hooks.onUnauthorized?.();
      }
    }



    if (!res.ok) {
      let errorMessage = `API error ${res.status}`;
      let errorCode;
      let retryAfterFromBody = null;
      try {
        const errorBody = await res.json();
        errorMessage = errorBody?.message || errorMessage;
        if (typeof errorBody?.retryAfterSeconds === 'number') {
          retryAfterFromBody = errorBody.retryAfterSeconds;
        }
        // Authorization failures carry a machine-readable code (e.g.
        // COLLEGE_RESTRICTED, PRIVATE) that callers use to pick the right UI
        // state. The status is attached too so callers can tell "denied" from
        // "missing" without string-matching the message.
        errorCode = errorBody?.code;
      } catch {
        // Non-JSON error body
      }
      const err = new Error(errorMessage);
      err.status = res.status;
      if (errorCode) err.code = errorCode;

      // Rate limited. The server sends `code: 'rate_limited'`, a human-readable
      // message and how long to wait; surface all three rather than letting a
      // bare "API error 429" reach the UI.
      //
      // `retryAfterSeconds` is attached so callers can show a countdown, and so
      // the React Query retry predicate in main.jsx can decline to retry — a
      // retried 429 spends another point against the very budget that just
      // refused, which turns being limited into being limited twice as hard.
      if (res.status === 429) {
        err.code = errorCode || 'rate_limited';
        const headerRetry = Number(res.headers.get('Retry-After'));
        err.retryAfterSeconds =
          retryAfterFromBody ??
          (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : null);
      }

      // A lifecycle state the SERVER knows about and this tab does not.
      //
      // Both gates mount off the cached profile, which is refreshed on sign-in.
      // So a second tab left open while the account was suspended elsewhere — or
      // put into its deletion window from the settings screen in the first tab —
      // holds a stale ACTIVE status, never mounts its gate, and instead shows the
      // user a stream of generic "403" toasts from every background fetch. Taking
      // the correction from the response and writing it to the cached profile
      // makes the right full-screen explanation appear in that tab too, without
      // waiting for a reload or a re-sync.
      // A policy update going live while this tab was open is handled by the same
      // hook: every background request comes back gated, and announcing it is
      // what makes the consent flow appear in the tab that hit the wall rather
      // than only in one that happens to boot afterwards. Which codes mean what
      // is the app's business, not the transport's — see `hooks` at the top of
      // this file.
      if (res.status === 403) {
        hooks.onApiErrorCode?.(errorCode);
      }

      throw err;
    }

    // 204 No Content
    if (res.status === 204) return null;

    const text = await res.text();
    if (!text) return null;

    if (text.trim().startsWith('<')) {
      throw new Error('API server returned HTML instead of JSON. Please check backend connection and VITE_API_URL setting.');
    }

    // Globally sanitize dicebear initials avatars from backend responses
    const sanitizedText = text.replace(/https:\/\/api\.dicebear\.com\/7\.x\/initials\/[^"'\\]+/g, '');
    try {
      return JSON.parse(sanitizedText);
    } catch (err) {
      /**
       * A 2xx body that is not JSON and not HTML.
       *
       * The guard above only catches markup. A hosting layer that answers with
       * plain text — Vercel's own 404 is literally `The page could not be
       * found`, served as text/plain — fell straight through to `JSON.parse`,
       * and the raw `SyntaxError: Unexpected token 'T', "The page c"... is not
       * valid JSON` became the error every caller reported. Several of them put
       * `err.message` directly on screen.
       *
       * Converted to one recognisable failure with the body kept on the error
       * for the console, so callers can show ordinary copy and developers still
       * get the evidence.
       */
      const parseError = new Error('API server returned a malformed response.');
      parseError.code = 'invalid_response';
      parseError.status = res.status;
      parseError.responseSnippet = sanitizedText.slice(0, 200);
      throw parseError;
    }
  }

  /**
   * Current access token (synchronous). Exposed so raw XHR/fetch flows that bypass
   * `apiClient` (e.g. direct presigned uploads) can authenticate against our own
   * backend endpoints. Never attach this to third-party (R2) presigned URLs.
   */
  const getAccessToken = () => getToken();

  const apiClient = {
    get: (path, { signal, timeoutMs } = {}) => request('GET', path, undefined, signal, timeoutMs),
    post: (path, body, { signal, timeoutMs, bearer } = {}) => request('POST', path, body, signal, timeoutMs, bearer),
    patch: (path, body, { signal, timeoutMs, bearer } = {}) => request('PATCH', path, body, signal, timeoutMs, bearer),
    put: (path, body, { signal, timeoutMs } = {}) => request('PUT', path, body, signal, timeoutMs),
    delete: (path, { signal, timeoutMs } = {}) => request('DELETE', path, undefined, signal, timeoutMs),
  };
  return {
    apiClient,
    request,
    getToken,
    getAccessToken,
    getBackendUrl,
    isApiFailoverActive,
    readCsrfCookie,
    rememberCsrfToken,
    forgetCsrfToken,
    mayHaveCookieSession,
    /**
     * Resolves once this client's stored credential has been loaded, if it has
     * one to load. The boot awaits it before asking `mayHaveCookieSession()`,
     * because on the installed app that answer is only meaningful afterwards.
     * Null on web, where there is nothing to wait for.
     */
    whenSessionReady: () => session.whenReady?.() ?? null,
    clearLocalAuthState,
  };
}
