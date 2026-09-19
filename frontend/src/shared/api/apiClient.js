/**
 * apiClient.js
 *
 * Central HTTP client for all backend API calls.
 * Automatically attaches the auth token from localStorage.
 *
 * Token caching: we keep a module-level reference updated via onAuthStateChange
 * so every API call is a synchronous read — no async getSession() per request.
 */
import { supabase, isRecoveryTab, clearRecoveryTab } from '@shared/lib/supabase';
import { applyAccountStatusCorrection } from '@shared/lib/accountStatusCorrection';
import {
  announceLegalConsentChange,
  LEGAL_ACK_REQUIRED_CODE,
} from '@shared/lib/legalConsent';
import { config } from '@config';

// ── Token cache ──────────────────────────────────────────────────────────────
// Seeded on module load; refreshed instantly on every auth state change.
let _cachedToken = '';
let _hasSession = false;
let _initSessionPromise = null;

/**
 * A password-recovery session must never become the token this client attaches.
 *
 * `AuthContext` already keeps a recovery session out of React state, so the app
 * never renders as signed in on the reset page. This cache had no such guard:
 * it has its own auth listener and cached whatever token came past, so while a
 * tab sat on /reset-password the recovery credential WAS the Authorization
 * header on every API call the client made.
 *
 * A recovery token is an ordinary session JWT — the backend cannot tell it from
 * a login, which is exactly why it must not be handed to it. The isolation has
 * to be enforced here, on the way out.
 *
 * Scoped to the tab, not to the event: `PASSWORD_RECOVERY` fires once, but the
 * session it establishes lives on through `INITIAL_SESSION` replays and token
 * refreshes, and each of those would otherwise cache it. `isRecoveryTab()` stays
 * true until the recovery session is signed out.
 */
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
export function readCsrfCookie() {
  try {
    if (typeof document === 'undefined') return '';
    const match = document.cookie.match(/(?:^|;\s*)mf_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_) {
    return '';
  }
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
export function rememberCsrfToken(token) {
  if (typeof token === 'string' && token) _csrfToken = token;
}

/** Dropped on sign-out with everything else the session owned. */
export function forgetCsrfToken() {
  _csrfToken = '';
}

/** What goes in `x-csrf-token`: what we were told, or what we can read. */
function csrfHeaderValue() {
  return _csrfToken || readCsrfCookie();
}

/** Methods the server never asks for a CSRF header on. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
  _cachedToken = '';
  _hasSession = false;
  forgetCsrfToken();
  try {
    localStorage.removeItem('loggedIn');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('meetifyy_recent_searches');
    localStorage.removeItem('meetify_muted_communities');
    localStorage.removeItem('read_invitations');
    localStorage.removeItem('meetify_following_list');
    localStorage.removeItem('meetify_followers_list');
  } catch (_) {
    // Storage disabled. Nothing was written, so nothing needs removing.
  }
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
export function mayHaveCookieSession() {
  if (readCsrfCookie()) return true;
  try {
    return localStorage.getItem('loggedIn') === 'true';
  } catch (_) {
    return false;
  }
}

function cacheSessionToken(session) {
  if (isRecoveryTab()) {
    _cachedToken = '';
    _hasSession = false;
    return;
  }
  _cachedToken = session?.access_token ?? '';
  _hasSession = !!session;
}

if (supabase) {
  // Seed immediately from stored session — keep reference so initial requests can await it
  _initSessionPromise = supabase.auth.getSession().then(({ data: { session } }) => {
    cacheSessionToken(session);
    return session;
  }).catch(() => null);

  // Keep in sync with all future auth events (login, logout, token refresh)
  supabase.auth.onAuthStateChange((event, session) => {
    // The reset page signs the recovery session out when it finishes (or when
    // the link turns out to be expired). That is the point the tab stops being
    // a recovery tab — withholding tokens past it would break every request a
    // user makes after signing back in without reloading.
    if (event === 'SIGNED_OUT') clearRecoveryTab();
    cacheSessionToken(session);
  });
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
export const API_PROXY_PREFIX = config.api.proxyPrefix;
const FAILOVER_FLAG = 'meetifyy_api_failover';

let _useProxyOrigin = (() => {
  try { return sessionStorage.getItem(FAILOVER_FLAG) === '1'; } catch { return false; }
})();

export const isApiFailoverActive = () => _useProxyOrigin;

function sameOriginProxyBase() {
  if (typeof window === 'undefined' || !window.location) return '';
  return `${window.location.origin}${API_PROXY_PREFIX}`;
}

/**
 * True when the same-origin proxy is a meaningful alternative: we are in a
 * browser, on a real deployment, and the API currently lives on a different
 * host. On localhost the API is already reachable or genuinely down, and there
 * is no proxy to fall back to.
 */
function canFailOver() {
  if (typeof window === 'undefined' || !window.location) return false;
  if (isLocalHost(window.location.hostname)) return false;
  const direct = directBackendUrl();
  if (!direct) return false;
  try {
    return new URL(direct).host !== window.location.host;
  } catch {
    return false;
  }
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
      try { sessionStorage.setItem(FAILOVER_FLAG, '1'); } catch {}
      // Realtime has to move with it; the socket store reads this event rather
      // than polling the flag.
      window.dispatchEvent(new Event('api:origin-changed'));
      return true;
    } catch {
      return false;
    } finally {
      _failoverProbe = null;
    }
  })();

  return _failoverProbe;
}

const isLocalHost = (host) => host === 'localhost' || host === '127.0.0.1';

const isLocalNetworkHost = (host) =>
  isLocalHost(host) ||
  /^(192\.168\.|10\.|100\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|.+\.local$)/.test(host) ||
  /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

/**
 * The API origin, entirely from configuration.
 *
 * A page served from localhost, Tailscale (100.x.x.x) or a LAN IP talks to a
 * backend on that same host — that is what makes testing from a phone on the
 * same Wi-Fi work. The behaviour and the port are both configurable
 * (VITE_API_PREFER_LOCAL, VITE_API_LOCAL_PORT); everywhere else the configured
 * VITE_API_URL is used verbatim.
 */
const directBackendUrl = () => {
  const { baseUrl, localPort, preferLocalBackend } = config.api;

  if (preferLocalBackend && typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, protocol } = window.location;
    if (isLocalNetworkHost(hostname)) {
      return `${protocol}//${hostname}:${localPort}`;
    }
  }

  if (!baseUrl) {
    // No API origin configured: same-origin (the dev server proxy, or a
    // deployment that serves the API under its own domain).
    return '';
  }

  // A secure page cannot call an insecure origin; upgrade rather than fail.
  if (
    typeof window !== 'undefined' &&
    window.location?.protocol === 'https:' &&
    baseUrl.startsWith('http://') &&
    !isLocalHost(new URL(baseUrl).hostname)
  ) {
    return baseUrl.replace(/^http:\/\//i, 'https://');
  }

  return baseUrl;
};

export const getBackendUrl = () => (_useProxyOrigin ? sameOriginProxyBase() : directBackendUrl());

const PASTEL_BG_COLORS = ['b6e3f4', 'c084fc', 'fde047', '86efac', 'fca5a5', 'fdba74', 'a5f3fc', 'f472b6'];

export const getPastelBgColor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return PASTEL_BG_COLORS[Math.abs(hash) % PASTEL_BG_COLORS.length];
};

export const normalizeDicebearUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('api.dicebear.com/')) return url;

  // Preserve existing backgroundColor parameter if already defined on the avatar URL
  if (url.includes('backgroundColor=')) {
    return url;
  }

  const bg = 'b6e3f4';
  const joinChar = url.includes('?') ? '&' : '?';
  return `${url}${joinChar}backgroundColor=${bg}`;
};

export const getMediaUrl = (pathOrUrl) => {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';

  let finalUrl = pathOrUrl;

  if (finalUrl.includes('api.dicebear.com/')) {
    finalUrl = normalizeDicebearUrl(finalUrl);
  }

  /**
   * Stored media URLs may carry the API origin of whichever machine wrote them,
   * which for anything created during local development is a private address.
   * Serving one to a public page is not just a dead image: the browser treats it
   * as the site reaching into the viewer's own network.
   *
   * This used to match one hardcoded shape, `localhost` or `127.0.0.1` on
   * exactly `localPort`. Anything else a developer's machine produces — a LAN
   * IP like 192.168.1.5, a Tailscale 100.x address, a `.local` name, or the same
   * host on a different port — did not match, passed through untouched, and was
   * handed to an <img> on the deployed site. Chrome 138+ answers that with the
   * "wants to access other devices on your local network" prompt, which is what
   * surfaced this; older browsers just made the request silently.
   *
   * So the test is now "is this origin private at all", using the same predicate
   * that decides where the API lives, and there are only two honest outcomes:
   * rewrite it to an origin this client can actually reach, or drop it. Handing
   * back a private URL is never one of them.
   */
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, protocol } = window.location;
    let parsed = null;
    if (/^https?:\/\//i.test(finalUrl)) {
      try { parsed = new URL(finalUrl); } catch { parsed = null; }
    }

    if (parsed && isLocalNetworkHost(parsed.hostname)) {
      const pathAndQuery = `${parsed.pathname}${parsed.search}`;

      if (isLocalNetworkHost(hostname)) {
        // The page is itself on the local network (a developer's machine, or a
        // phone on the same Wi-Fi). The backend is on this host, whichever
        // address the URL was written with.
        finalUrl = `${protocol}//${hostname}:${config.api.localPort}${pathAndQuery}`;
      } else {
        // A public page. The private origin is unreachable from here for
        // everyone except the machine that wrote it, so the only options are
        // the configured API or nothing.
        const backend = getBackendUrl();
        if (!backend) return '';
        finalUrl = `${backend}${pathAndQuery}`;
      }
    }
  }

  if (finalUrl.startsWith('http://') || finalUrl.startsWith('https://') || finalUrl.startsWith('data:') || finalUrl.startsWith('blob:')) {
    return finalUrl;
  }
  // Anything reaching here is treated as a media key and turned into
  // /api/media/<key>. Guard against values that cannot be one: a stray initial
  // or label produced requests like GET /api/media/H, which the backend
  // answered with 400 on every render. A real key always carries a path
  // separator or a file extension.
  const candidate = finalUrl.replace(/^\/+/, '');
  const looksLikeMediaKey = candidate.includes('/') || /\.[a-z0-9]{2,5}$/i.test(candidate);
  if (!looksLikeMediaKey) return '';

  const cleanPath = finalUrl.startsWith('/api/media/')
    ? finalUrl
    : `/api/media/${candidate}`;
  const backendUrl = getBackendUrl();
  return `${backendUrl.replace(/\/+$/, '')}${cleanPath}`;
};

/**
 * Derives the object key of an image's lightweight thumbnail variant from the
 * original's key/URL, using the convention `<folder>/<name>.<ext>` ->
 * `<folder>/<name>_thumb.webp`. Returns null for anything that isn't one of our
 * own uploaded R2/media images (external URLs, data/blob URLs, already-a-thumb),
 * so callers can fall back to the original safely.
 */
export const deriveThumbnailKey = (rawSrc) => {
  if (!rawSrc || typeof rawSrc !== 'string') return null;
  let key = rawSrc.trim();
  if (key.startsWith('data:') || key.startsWith('blob:')) return null;

  // Full external URLs that aren't our media endpoint are not derivable.
  if ((key.startsWith('http://') || key.startsWith('https://'))) {
    const m = key.match(/\/api\/media\/(.+)$/);
    if (!m) return null;
    key = m[1];
  } else if (key.includes('/api/media/')) {
    const m = key.match(/\/api\/media\/(.+)$/);
    if (m) key = m[1];
  }
  key = key.split('?')[0].replace(/^\/+/, '');

  // Only derive for our folder/uuid.ext keys; skip if it's already a thumbnail.
  if (/_thumb\.[a-z0-9]+$/i.test(key)) return null;
  const match = key.match(/^([a-z0-9_-]+)\/([A-Za-z0-9._-]+)\.(webp|jpe?g|png|gif|mp4|webm|ogv|mov)$/i);
  if (!match) return null;
  const [, folder, name] = match;
  return `${folder}/${name}_thumb.webp`;
};

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
  if (isRecoveryTab()) return '';
  return _cachedToken;
}

// ── In-flight request deduplication ─────────────────────────────────────────
// Prevents duplicate network calls when multiple components request the same
// URL before the first response resolves (common on route mount).
const _inflight = new Map();

// ── ETag store ───────────────────────────────────────────────────────────────
// Stores the last ETag per URL in sessionStorage so If-None-Match can be sent,
// enabling 304 Not Modified responses when data hasn't changed.
const ETAG_PREFIX = '__etag__';
function getStoredEtag(url) {
  try { return sessionStorage.getItem(ETAG_PREFIX + url) || ''; } catch { return ''; }
}
function storeEtag(url, etag) {
  try { if (etag) sessionStorage.setItem(ETAG_PREFIX + url, etag); } catch {}
}
function dropEtag(url) {
  try { sessionStorage.removeItem(ETAG_PREFIX + url); } catch {}
}

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
      if (isRecoveryTab()) return false;

      const url = `${getBackendUrl().replace(/\/+$/, '')}/api/auth/session/refresh`;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
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

const PUBLIC_PATHS = [
  // Signup and its confirmation-code resend. Both are made before the account
  // has a session by definition — that is the whole point of the step — and
  // `/api/auth/signup` also covers `/api/auth/signup/resend` by prefix.
  '/api/auth/signup',
  '/api/auth/login',
  '/api/health',
  // These are called during signup before the user has a session
  '/api/auth/check-username',
  '/api/auth/check-email',
  // Forgot password. The person asking is by definition signed out, so without
  // this entry `request` refuses the call before a byte reaches the network and
  // the reset screen fails for everyone who actually needs it.
  '/api/auth/request-password-reset',
  '/api/auth/account-exists',
  // The help centre and the support-request form. These have to work for a
  // signed-out visitor — someone locked out of their account is exactly the
  // person who needs them — so without this entry `request` rejects every call
  // with "Missing access token" before a single byte reaches the network, and
  // the public Help & Support page can never load its content.
  '/api/support',
  // Public reference data: signup needs the catalog before a session exists,
  // and colleges are required for the college-selection step of signup.
  // The backend controller marks both as deliberately unauthenticated.
  '/api/academics/catalog',
  '/api/academics/colleges',
  // The public view of a shared post. A visitor arriving from a link on
  // WhatsApp has no session by definition, and without this entry `request`
  // rejects the call before a byte reaches the network — which presented every
  // valid shared link as "post not found", indistinguishably from a genuinely
  // private one. The server applies the real gate (see
  // backend/src/share/share-preview.service.ts); this list only decides whether
  // the browser is willing to ask.
  '/api/share',
  // The published legal documents. The Terms and Privacy pages are linked from
  // the landing footer and the signup form, so the reader is signed out by
  // definition — and a user held behind the mandatory-acknowledgement gate has
  // to be able to read the document they are being asked to accept. Without
  // this entry `request` rejects both cases with "Missing access token" before
  // a byte reaches the network, and the page renders its error state.
  //
  // Only the two document routes. `/api/legal/consent` is deliberately NOT
  // here: it is about a specific user and must carry their token.
  '/api/legal/documents',
  // "Bring Meetifyy to your campus" on the landing page. The person asking for
  // their college to be added has, by definition, no account yet — that is the
  // entire point of the form. The server treats this route as public too (see
  // AuthController.requestCollege: rate limiting only, no JwtGuard), so
  // without this entry `request` would refuse the call before a byte reached
  // the network and the form could never work for its actual audience.
  '/api/auth/request-college',
];

/**
 * Paths that authenticate with the bearer token rather than the cookie.
 *
 * Only the handover at the end of signup. `verifyOtp` answers with a provider
 * session and no cookies exist yet, so these two calls are the one place where
 * waiting for the token to be in hand still decides whether the request works.
 */
const BEARER_PATHS = ['/api/auth/session/adopt', '/api/users/me'];

function isBearerPath(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return BEARER_PATHS.some((p) => clean === p || clean.startsWith(`${p}?`));
}

function isPublicPath(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return PUBLIC_PATHS.some(p => clean === p || clean.startsWith(`${p}?`) || clean.startsWith(`${p}/`));
}

async function request(method, path, body, signal, timeoutMs) {
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
  if (!_cachedToken && _initSessionPromise && isBearerPath(path)) {
    await _initSessionPromise;
  }

  const token = getToken(); // synchronous

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

  if (res.status === 401 && !isRetry && !options.publicPath) {
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
      window.dispatchEvent(new Event('auth:unauthorized'));
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
    if (res.status === 403) {
      applyAccountStatusCorrection(errorCode);

      // A policy update went live while this tab was open. Every background
      // request now comes back gated, and without this the user would see a
      // stream of generic 403 toasts with no way to resolve them. Announcing it
      // is what makes the consent flow appear in the tab that hit the wall,
      // rather than only in one that happens to boot afterwards.
      if (errorCode === LEGAL_ACK_REQUIRED_CODE) {
        announceLegalConsentChange('required');
      }
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

if (typeof window !== 'undefined') {
  window.__api_redirecting = false;
}

/**
 * Current access token (synchronous). Exposed so raw XHR/fetch flows that bypass
 * `apiClient` (e.g. direct presigned uploads) can authenticate against our own
 * backend endpoints. Never attach this to third-party (R2) presigned URLs.
 */
export const getAccessToken = () => getToken();

export const apiClient = {
  get: (path, { signal, timeoutMs } = {}) => request('GET', path, undefined, signal, timeoutMs),
  post: (path, body, { signal, timeoutMs } = {}) => request('POST', path, body, signal, timeoutMs),
  patch: (path, body, { signal, timeoutMs } = {}) => request('PATCH', path, body, signal, timeoutMs),
  put: (path, body, { signal, timeoutMs } = {}) => request('PUT', path, body, signal, timeoutMs),
  delete: (path, { signal, timeoutMs } = {}) => request('DELETE', path, undefined, signal, timeoutMs),
};

// ──────────────────────────────────────────────
// Named API helpers (expand as modules are built)
// ──────────────────────────────────────────────

export const authApi = {
  /**
   * Sync the current user's Supabase profile to the Postgres database.
   * Call this once after login/signup.
   */
  syncProfile: () => apiClient.post('/api/auth/sync'),

  /**
   * "Am I signed in?" — the one call a boot makes before deciding anything.
   *
   * A GET, so it carries no CSRF requirement and works on every deployment
   * shape, including the ones where the page cannot read `mf_csrf`. Returns
   * the caller's profile, or throws 401 when the cookies authenticate nobody.
   */
  currentSession: ({ signal } = {}) =>
    apiClient.get('/api/auth/session', { signal }),

  /**
   * Hands the server the provider session `verifyOtp` just minted, in exchange
   * for cookies. The last step of signup, and the point at which the refresh
   * token stops being reachable from JavaScript.
   */
  adoptSession: (refreshToken) =>
    apiClient.post('/api/auth/session/adopt', { refreshToken }),

  /**
   * Ends this device's session server-side and clears its cookies.
   *
   * Without this, signing out was a purely local act: the row stayed live and
   * the cookies stayed in the browser, so the next reload signed the person
   * back in — and on a shared machine, signed the next person in as them.
   */
  logoutSession: () => apiClient.post('/api/auth/session/logout'),
};

export const postsApi = {
  /**
   * Fetch the main feed with cursor-based pagination.
   * @param {number} limit - Number of posts per page (default 10)
   * @param {string|undefined} cursor - ID of last seen post for pagination
   */
  getFeed: (limit = 10, cursor, communityId) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    if (communityId) params.set('communityId', communityId);
    return apiClient.get(`/api/posts/feed?${params.toString()}`);
  },

  /**
   * Fetch a user's posts.
   */
  getUserPosts: (username, limit = 10, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/posts/user/${username}?${params.toString()}`);
  },

  /**
   * Create a new post.
   * @param {{ text: string, mediaKey?: string, communityId?: string }} data
   */
  createPost: (data) => apiClient.post('/api/posts', data),

  /** Like a post by ID */
  likePost: (postId, { signal } = {}) => apiClient.post(`/api/posts/${postId}/like`, undefined, { signal }),

  /** Unlike a post by ID */
  unlikePost: (postId, { signal } = {}) => apiClient.post(`/api/posts/${postId}/unlike`, undefined, { signal }),

  /**
   * Add a comment to a post.
   * @param {string} postId
   * @param {{ text: string, parentId?: string }} data
   */
  addComment: (postId, data) => apiClient.post(`/api/posts/${postId}/comments`, data),
  /**
   * Load a page of a post's comments (roots + their reply subtrees) beyond the
   * first page embedded in getPostById. Cursor is the previous page's nextCursor.
   */
  getComments: (postId, limit = 20, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/posts/${postId}/comments?${params.toString()}`);
  },
  likeComment: (commentId, { signal } = {}) => apiClient.post(`/api/posts/comments/${commentId}/like`, undefined, { signal }),
  unlikeComment: (commentId, { signal } = {}) => apiClient.post(`/api/posts/comments/${commentId}/unlike`, undefined, { signal }),
  deleteComment: (commentId) => apiClient.delete(`/api/posts/comments/${commentId}`),
  getPostById: (postId) => apiClient.get(`/api/posts/${postId}`),
  /**
   * 12s rather than the 30s default: the card sits under a visible "Deleting
   * post..." spinner for the whole request, and a user watching that spinner
   * decides the app is broken long before thirty seconds. The server side is
   * two database round trips, so anything past a few seconds is a stalled
   * connection rather than slow work — failing at 12s lets the post come back
   * with an error the user can act on instead of a spinner that never ends.
   */
  deletePost: (postId) => apiClient.delete(`/api/posts/${postId}`, { timeoutMs: 12_000 }),

  voteInPoll: (postId, payload) => {
    const body = Array.isArray(payload) ? { indices: payload } : (typeof payload === 'object' ? payload : { index: payload });
    return apiClient.post(`/api/posts/${postId}/vote`, body);
  },
  bookmarkPost: (postId, { signal } = {}) => apiClient.post(`/api/posts/${postId}/bookmark`, undefined, { signal }),
  unbookmarkPost: (postId, { signal } = {}) => apiClient.delete(`/api/posts/${postId}/bookmark`, { signal }),
  getBookmarks: (limit = 10, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/posts/bookmarks?${params.toString()}`);
  },
};

/**
 * The public, unauthenticated view of a post.
 *
 * The only surface that serves post content without a session, and
 * deliberately narrow: the author, the text and the first image, and nothing
 * about comments, likes, bookmarks or the viewer. It is what a signed-out
 * visitor arriving from a shared link is shown, so widening it widens what
 * "sharing a link" exposes. The server enforces that; this is just the caller.
 *
 * See `backend/src/share/share-preview.service.ts`.
 */
export const shareApi = {
  /**
   * Rejects with `status === 404` for a post that is not publicly shareable —
   * deleted, private, in a restricted community, by an unavailable author, or
   * simply not a post. The server answers all of those identically on purpose,
   * so callers must not try to tell them apart.
   */
  getPublicPost: (postId, { signal } = {}) =>
    apiClient.get(`/api/share/post/${encodeURIComponent(postId)}`, { signal }),
};

export const linkPreviewApi = {
  /**
   * Fetch Open Graph metadata for a URL via the backend proxy (SSRF-safe).
   * @param {string} url - The URL to preview
   */
  getPreview: (url) => {
    const params = new URLSearchParams({ url });
    return apiClient.get(`/api/link-preview?${params.toString()}`);
  },
};

// Maps DB field names → frontend field names used throughout the UI.
// avatarKey → avatar, coverKey → coverImage.
const normalizeCommunity = (c) => {
  if (!c) return c;
  return {
    ...c,
    avatar: c.avatar ?? c.avatarKey ?? null,
    coverImage: c.coverImage ?? c.coverKey ?? null,
  };
};

export const communitiesApi = {
  getAll: () => apiClient.get('/api/communities').then((list) => (Array.isArray(list) ? list.map(normalizeCommunity) : list)),
  // Discovery suggestions: communities the viewer has NOT joined, drawn at
  // random from the most popular of the rest. Server-ranked and server-sampled
  // so the panel varies per load without the client fetching a wide list to
  // filter down.
  getRecommendations: (limit = 10) =>
    apiClient
      .get(`/api/communities/recommendations?limit=${limit}`)
      .then((list) => (Array.isArray(list) ? list.map(normalizeCommunity) : list)),
  getCampusCommunities: (search) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return apiClient.get(`/api/communities/campus${qs}`).then((list) => (Array.isArray(list) ? list.map(normalizeCommunity) : list));
  },
  getById: (id) => apiClient.get(`/api/communities/${id}`).then(normalizeCommunity),
  create: (data) => apiClient.post('/api/communities', data).then(normalizeCommunity),
  join: (id, { signal } = {}) => apiClient.post(`/api/communities/${id}/join`, undefined, { signal }),
  leave: (id, { signal } = {}) => apiClient.post(`/api/communities/${id}/leave`, undefined, { signal }),
  delete: (id) => apiClient.delete(`/api/communities/${id}`),
  updateGroupInfo: (id, data) => apiClient.patch(`/api/communities/${id}`, data).then(normalizeCommunity),
  removeGroupMember: (id, memberId) => apiClient.delete(`/api/communities/${id}/members/${memberId}`),
  // PATCH /:id/members/:userId/role has existed on the server since roles were
  // added, but was never reachable from the client — there was no way to
  // promote or demote a moderator anywhere in the UI.
  updateMemberRole: (id, memberId, role) =>
    apiClient.patch(`/api/communities/${id}/members/${memberId}/role`, { role }),
  // The moderator permission set, served from the same table the backend
  // enforces with — so the promotion modals show what is actually applied
  // rather than a copy that quietly goes stale.
  getModeratorPermissions: () => apiClient.get('/api/communities/moderator-permissions'),
  getModeratorNotice: (id) => apiClient.get(`/api/communities/${id}/moderator-notice`),
  acknowledgeModeratorNotice: (id) => apiClient.post(`/api/communities/${id}/moderator-notice/ack`),
  getPendingRequests: (id) => apiClient.get(`/api/communities/${id}/requests`),
  getJoinRequests: (id) => apiClient.get(`/api/communities/${id}/requests`),
  acceptJoinRequest: (id, requestId) => apiClient.post(`/api/communities/${id}/requests/${requestId}/accept`),
  approveJoinRequest: (id, requestId) => apiClient.post(`/api/communities/${id}/requests/${requestId}/accept`),
  declineJoinRequest: (id, requestId) => apiClient.post(`/api/communities/${id}/requests/${requestId}/decline`),
};

export const activitiesApi = {
  getAll: (limit = 20, cursor, scope = 'public') => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    if (scope && scope !== 'public') params.set('scope', scope);
    return apiClient.get(`/api/activities?${params.toString()}`);
  },
  getDiscover: () => apiClient.get('/api/activities/discover'),
  getMyActivities: () => apiClient.get('/api/activities/me'),
  getById: (id) => apiClient.get(`/api/activities/${id}`),
  create: (data) => apiClient.post('/api/activities', data),
  join: (id, { signal } = {}) => apiClient.post(`/api/activities/${id}/join`, undefined, { signal }),
  leave: (id, { signal } = {}) => apiClient.post(`/api/activities/${id}/leave`, undefined, { signal }),
  getDiscussion: (id, { before, limit = 20 } = {}) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return apiClient.get(`/api/activities/${id}/discussion${qs ? `?${qs}` : ''}`);
  },
  sendDiscussionMessage: (id, text) => apiClient.post(`/api/activities/${id}/discussion`, { text }),
  cancelCrewActivity: (id) => apiClient.post(`/api/activities/${id}/cancel`),
  endCrewActivity: (id) => apiClient.post(`/api/activities/${id}/cancel`),
  inviteFriends: (id, userIds) => apiClient.post(`/api/activities/${id}/invite`, { userIds }),
  getPendingInvitations: () => apiClient.get('/api/activities/invitations/me'),
  acceptInvitation: (invitationId) => apiClient.post(`/api/activities/invitations/${invitationId}/accept`),
  declineInvitation: (invitationId) => apiClient.post(`/api/activities/invitations/${invitationId}/decline`),
  getInvitationStatuses: (id) => apiClient.get(`/api/activities/${id}/invitations/status`),
  getAttendees: (id, { cursor, limit = 30 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/activities/${id}/attendees?${params.toString()}`);
  },
  /** Host-only. Accepts 'PUBLIC' | 'COLLEGE_ONLY' | 'PRIVATE'. */
  updateVisibility: (id, visibility) => apiClient.patch(`/api/activities/${id}/visibility`, { visibility }),
  /** Host-only: withdraw an outstanding invitation. */
  revokeInvitation: (id, userId) => apiClient.delete(`/api/activities/${id}/invitations/${userId}`),
  bookmark: (id) => apiClient.post(`/api/activities/${id}/bookmark`),
  unbookmark: (id) => apiClient.delete(`/api/activities/${id}/bookmark`),
  getBookmarks: (limit = 20, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.append('cursor', cursor);
    return apiClient.get(`/api/activities/bookmarks?${params.toString()}`);
  },
  getSavedActivities: (limit = 20, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.append('cursor', cursor);
    return apiClient.get(`/api/activities/bookmarks?${params.toString()}`);
  },
  getBookmarkIds: () => apiClient.get('/api/activities/bookmarks/ids'),
};

/**
 * The signed-in devices behind the account.
 *
 * Backed by the UserSession table — these are the rows that make a session
 * revocable at all, so what this lists is exactly what can be signed out.
 */
export const sessionsApi = {
  list: () => apiClient.get('/api/auth/sessions'),
  revoke: (id) => apiClient.delete(`/api/auth/sessions/${id}`),
  /** Signs out every other device, leaving this one alone. */
  revokeOthers: () => apiClient.post('/api/auth/sessions/revoke-all', { scope: 'others' }),
};

export const usersApi = {
  getConnections: (query = '', limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query) params.set('q', query);
    return apiClient.get(`/api/users/connections?${params.toString()}`);
  },
  getAll: (limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get(`/api/users?${params.toString()}`);
  },
  getCampusUsers: (limit = 100, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get(`/api/users/campus?${params.toString()}`);
  },
  // Server-side campus directory: search + course/branch/currentYear, keyset pagination.
  getDirectory: ({ search, course, branch, year, limit = 30, cursor } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (search) params.set('search', search);
    if (course && course !== 'All') params.set('course', course);
    if (branch && branch !== 'All') params.set('branch', branch);
    if (year && year !== 'All') params.set('year', String(year));
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/users/directory?${params.toString()}`);
  },
  searchMentions: (query = '', communityId = null, limit = 15) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query) params.set('q', query);
    if (communityId) params.set('communityId', communityId);
    return apiClient.get(`/api/users/mention-search?${params.toString()}`);
  },
  getOnlineFriends: (limit = 6) => apiClient.get(`/api/users/online-friends?limit=${limit}`),
  // "Who to follow". Server-ranked, block- and follow-filtered, and every row
  // carries an authoritative `isFollowing`. Replaces the old client-side
  // derivation from getAll() + campus users + conversation participants.
  getRecommendations: (limit = 10) =>
    apiClient.get(`/api/users/recommendations?limit=${limit}`),
  getByUsername: (username) => apiClient.get(`/api/users/${username}`),
  // `eligibleOnly` is for recipient pickers only. The profile's follower and
  // following viewer must never pass it: hiding accounts there would misreport
  // who follows whom and contradict the counts shown next to the list.
  getFollowers: (username, limit = 50, offset = 0, eligibleOnly = false) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (eligibleOnly) params.set('eligibleOnly', 'true');
    return apiClient.get(`/api/users/${username}/followers?${params.toString()}`);
  },
  getFollowing: (username, limit = 50, offset = 0, eligibleOnly = false) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (eligibleOnly) params.set('eligibleOnly', 'true');
    return apiClient.get(`/api/users/${username}/following?${params.toString()}`);
  },
  // `getFollowingUsernames` was here: a `?limit=1000` fetch of the viewer's
  // whole following list, so a caller could check membership in JavaScript.
  // Nothing called it any more, and the pattern is the bug — a relationship
  // past the limit reads as "not following", and the answer silently depends
  // on how many people the account follows. Follow state is now carried on the
  // payloads that render it, resolved per row against the Follow table.
  follow: (username, { signal } = {}) => apiClient.post(`/api/users/${username}/follow`, undefined, { signal }),
  unfollow: (username, { signal } = {}) => apiClient.post(`/api/users/${username}/unfollow`, undefined, { signal }),
  getById: (id) => apiClient.get(`/api/users/id/${id}`),
  updateProfile: (data) => apiClient.patch('/api/users/me', data),
  getSettings: () => apiClient.get('/api/users/me/settings'),
  updateSettings: (data) => apiClient.patch('/api/users/me/settings', data),
  blockUser: (targetUserId) => apiClient.post(`/api/users/block/${targetUserId}`),
  unblockUser: (targetUserId) => apiClient.delete(`/api/users/block/${targetUserId}`),
};

export const dmApi = {
  getConversations: (limit, offset) => apiClient.get(`/api/dm?limit=${limit || 20}&offset=${offset || 0}`),
  lookupDM: (targetUserId) => apiClient.get(`/api/dm/lookup/${targetUserId}`),
  // Answers "can these two message each other right now?" without creating a
  // conversation — used by the draft screen, which has no conversation to read.
  getMessagingEligibility: (targetUserId) => apiClient.get(`/api/dm/eligibility/${targetUserId}`),
  startDM: (targetUserId) => apiClient.post('/api/dm', { targetUserId }),
  getHistory: (conversationId, deviceId, beforeCursor, limit) => {
    const params = new URLSearchParams();
    if (deviceId) params.set('deviceId', deviceId);
    if (beforeCursor) params.set('before', beforeCursor);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return apiClient.get(`/api/dm/${conversationId}${query ? `?${query}` : ''}`);
  },
  sendMessage: (conversationId, payload) => apiClient.post(`/api/dm/${conversationId}/messages`, payload),
  markAsRead: (conversationId) => apiClient.post(`/api/dm/${conversationId}/read`),
  muteConversation: (conversationId, muted) => apiClient.patch(`/api/dm/${conversationId}/mute`, { muted }),
  pinConversation: (conversationId, pinned) => apiClient.patch(`/api/dm/${conversationId}/pin`, { pinned }),
  clearChat: (conversationId) => apiClient.post(`/api/dm/${conversationId}/clear`),
  deleteConversation: (conversationId) => apiClient.delete(`/api/dm/${conversationId}`),
  unsendMessage: (messageId) => apiClient.delete(`/api/dm/msg/${messageId}`),
  deleteMessageForMe: (messageId) => apiClient.delete(`/api/dm/msg/${messageId}/for-me`),
  forwardMessage: (messageId, targetConversationIds) => apiClient.post(`/api/dm/msg/${messageId}/forward`, { targetConversationIds }),
  reactToMessage: (messageId, reaction) => apiClient.post(`/api/dm/${messageId}/react`, { reaction }),
};

export const groupApi = {
  getConversations: (limit, offset) => apiClient.get(`/api/group-chats?limit=${limit || 20}&offset=${offset || 0}`),
  getDetails: (conversationId) => apiClient.get(`/api/group-chats/${conversationId}/details`),
  createGroup: (name, userIds) => apiClient.post('/api/group-chats', { name, userIds }),
  getHistory: (conversationId, deviceId, beforeCursor, limit) => {
    const params = new URLSearchParams();
    if (deviceId) params.set('deviceId', deviceId);
    if (beforeCursor) params.set('before', beforeCursor);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return apiClient.get(`/api/group-chats/${conversationId}${query ? `?${query}` : ''}`);
  },
  sendMessage: (conversationId, payload) => apiClient.post(`/api/group-chats/${conversationId}/messages`, payload),
  markAsRead: (conversationId) => apiClient.post(`/api/group-chats/${conversationId}/read`),
  muteConversation: (conversationId, muted) => apiClient.patch(`/api/group-chats/${conversationId}/mute`, { muted }),
  pinConversation: (conversationId, pinned) => apiClient.patch(`/api/group-chats/${conversationId}/pin`, { pinned }),
  clearChat: (conversationId) => apiClient.post(`/api/group-chats/${conversationId}/clear`),
  deleteConversation: (conversationId) => apiClient.delete(`/api/group-chats/${conversationId}`),
  updateGroupInfo: (conversationId, data) => apiClient.patch(`/api/group-chats/${conversationId}/info`, data),
  addMember: (conversationId, userId) => apiClient.post(`/api/group-chats/${conversationId}/members`, { userId }),
  removeMember: (conversationId, targetUserId) => apiClient.delete(`/api/group-chats/${conversationId}/members/${targetUserId}`),
  leaveGroup: (conversationId) => apiClient.post(`/api/group-chats/${conversationId}/leave`),
  endGroup: (conversationId) => apiClient.post(`/api/group-chats/${conversationId}/end`),
  updateSettings: (conversationId, data) => apiClient.patch(`/api/group-chats/${conversationId}/settings`, data),
  updatePermissions: (conversationId, permission) => apiClient.patch(`/api/group-chats/${conversationId}/permissions`, { permission }),
  changeOwner: (conversationId, targetUserId) => apiClient.post(`/api/group-chats/${conversationId}/owner`, { targetUserId }),
  promoteAdmin: (conversationId, targetUserId) => apiClient.post(`/api/group-chats/${conversationId}/admins`, { targetUserId }),
  demoteAdmin: (conversationId, targetUserId) => apiClient.delete(`/api/group-chats/${conversationId}/admins/${targetUserId}`),
  acceptJoinRequest: (conversationId, targetUserId) => apiClient.post(`/api/group-chats/${conversationId}/requests/${targetUserId}/accept`),
  declineJoinRequest: (conversationId, targetUserId) => apiClient.post(`/api/group-chats/${conversationId}/requests/${targetUserId}/decline`),
  joinGroup: (conversationId) => apiClient.post(`/api/group-chats/${conversationId}/join`),
  // Readable by non-members — this is what an invite link resolves against.
  getInvitePreview: (conversationId) => apiClient.get(`/api/group-chats/${conversationId}/invite`),
  unsendMessage: (messageId) => apiClient.delete(`/api/group-chats/msg/${messageId}`),
  deleteMessageForMe: (messageId) => apiClient.delete(`/api/group-chats/msg/${messageId}/for-me`),
  forwardMessage: (messageId, targetConversationIds) => apiClient.post(`/api/group-chats/msg/${messageId}/forward`, { targetConversationIds }),
  reactToMessage: (messageId, reaction) => apiClient.post(`/api/group-chats/${messageId}/react`, { reaction }),
};



/**
 * Instant Match state, over HTTP.
 *
 * Everything else about Instant Match is a socket exchange, and that is right
 * for a realtime feature — but it made the very first question ("am I matched
 * right now?") wait on the socket's connect and authentication handshake. The
 * launcher rendered its unmatched default in the meantime, so a matched user
 * saw the wrong button until the connection came up and then watched it flip.
 * This is the boot read: it goes out with the app's other startup requests and
 * answers in one round trip. The socket reconciles on top of it afterwards.
 */
export const instantMatchApi = {
  getState: () => apiClient.get('/api/instant-match/state'),
};

export const messagesApi = {
  /**
   * @param {boolean} [eligibleOnly] Ask the server for threads that can actually
   *   be sent into. Share and Forward pickers pass true; the inbox must not,
   *   because it has to keep showing every conversation the user owns.
   */
  getConversations: (limit, offset, eligibleOnly = false, search = '') => {
    const params = new URLSearchParams();
    const resolvedLimit = typeof limit === 'number' ? limit : (typeof limit === 'object' && typeof limit?.limit === 'number' ? limit.limit : 20);
    const resolvedOffset = typeof offset === 'number' ? offset : (typeof limit === 'object' && typeof limit?.offset === 'number' ? limit.offset : 0);
    
    if (resolvedLimit) params.set('limit', String(resolvedLimit));
    if (resolvedOffset) params.set('offset', String(resolvedOffset));
    if (eligibleOnly) params.set('eligibleOnly', 'true');
    // Matched by the database against the group's name or the DM partner's
    // handle, so a picker's search reaches every eligible thread rather than
    // only the page already in memory.
    const resolvedSearch = typeof search === 'string' ? search.trim() : '';
    if (resolvedSearch) params.set('search', resolvedSearch);
    const query = params.toString();
    return apiClient.get(`/api/messages${query ? `?${query}` : ''}`);
  },
  getHistory: (conversationId, deviceId, beforeCursor, limit) => {
    const params = new URLSearchParams();
    if (deviceId) params.set('deviceId', deviceId);
    if (beforeCursor) params.set('before', beforeCursor);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return apiClient.get(`/api/messages/${conversationId}${query ? `?${query}` : ''}`);
  },
  sendDirectMessage: (conversationId, payload) => apiClient.post(`/api/messages/${conversationId}/messages`, payload),
  // `sendMessage` is the name every generic caller uses: useChatManager picks
  // one of dmApi / groupApi / messagesApi by chat type and then calls
  // `.sendMessage(...)` on whichever it got. Only this object was missing it,
  // so that call resolved to `undefined` and threw.
  //
  // That path is the REST fallback — used when the socket is down, and after a
  // 5s socket-ack timeout — so the failure was invisible for dm/group chats
  // (they hit dmApi/groupApi, which have the method) and hit exactly one
  // surface: the Instant Match chat, the only chat that runs on `messagesApi`.
  // Every send there that fell back to REST threw, was swallowed by the
  // `catch`, and left the message stuck as a failed optimistic bubble that
  // never became a real message.
  sendMessage: (conversationId, payload) => apiClient.post(`/api/messages/${conversationId}/messages`, payload),
  startConversation: (userIds, name) => apiClient.post('/api/messages', { userIds, name }),
  reactToMessage: (messageId, reaction) => apiClient.post(`/api/messages/${messageId}/react`, { reaction }),
  markAsRead: (conversationId) => apiClient.post(`/api/messages/${conversationId}/read`),
  muteConversation: (conversationId, muted) => apiClient.patch(`/api/messages/${conversationId}/mute`, { muted }),
  pinConversation: (conversationId, pinned) => apiClient.patch(`/api/messages/${conversationId}/pin`, { pinned }),
  clearChat: (conversationId) => apiClient.post(`/api/messages/${conversationId}/clear`),
  deleteConversation: (conversationId) => apiClient.delete(`/api/messages/${conversationId}/conversations`),
  updateGroup: (conversationId, data) => apiClient.patch(`/api/messages/${conversationId}/group`, data),
  addMember: (conversationId, userId) => apiClient.post(`/api/messages/${conversationId}/members`, { userId }),
  removeMember: (conversationId, targetUserId) => apiClient.delete(`/api/messages/${conversationId}/members/${targetUserId}`),
  leaveGroup: (conversationId) => apiClient.post(`/api/messages/${conversationId}/leave`),
  unsendMessage: (messageId) => apiClient.delete(`/api/messages/msg/${messageId}`),
  deleteMessageForMe: (messageId) => apiClient.delete(`/api/messages/msg/${messageId}/for-me`),
  forwardMessage: (messageId, targetConversationIds) => apiClient.post(`/api/messages/msg/${messageId}/forward`, { targetConversationIds }),
  updateSettings: (conversationId, data) => apiClient.patch(`/api/messages/${conversationId}/settings`, data),
  updatePermissions: (conversationId, permission) => apiClient.patch(`/api/messages/${conversationId}/permissions`, { permission }),
  changeOwner: (conversationId, targetUserId) => apiClient.post(`/api/messages/${conversationId}/owner`, { targetUserId }),
  promoteAdmin: (conversationId, targetUserId) => apiClient.post(`/api/messages/${conversationId}/admins`, { targetUserId }),
  demoteAdmin: (conversationId, targetUserId) => apiClient.delete(`/api/messages/${conversationId}/admins/${targetUserId}`),
  endGroup: (conversationId) => apiClient.post(`/api/messages/${conversationId}/end`),
  acceptJoinRequest: (conversationId, targetUserId) => apiClient.post(`/api/messages/${conversationId}/requests/${targetUserId}/accept`),
  declineJoinRequest: (conversationId, targetUserId) => apiClient.post(`/api/messages/${conversationId}/requests/${targetUserId}/decline`),
  requestToJoinGroup: (conversationId) => apiClient.post(`/api/messages/${conversationId}/request`),
  joinGroup: (conversationId) => apiClient.post(`/api/messages/${conversationId}/join`),
};

export const healthApi = {
  check: () => apiClient.get('/health'),
};

export const uploadsApi = {
  uploadMedia: (file, folder = 'general') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    return apiClient.post('/api/media/upload', formData);
  },
  /**
   * Discard an orphaned upload (owned + not yet attached to a post). Best-effort
   * cleanup used when post creation fails after a successful media upload.
   */
  discard: (key) => apiClient.post('/api/media/discard', { key }),
};

// ── Campus Events (official campus event discovery) ────────────────────────────
export const campusEventsApi = {
  list: (scope = 'upcoming', { limit = 20, cursor, campusId } = {}) => {
    const params = new URLSearchParams({ scope, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    if (campusId) params.set('campusId', campusId);
    return apiClient.get(`/api/campus-events?${params.toString()}`);
  },
  getMine: () => apiClient.get('/api/campus-events/mine'),
  getById: (id) => apiClient.get(`/api/campus-events/${id}`),
  create: (data) => apiClient.post('/api/campus-events', data),
  update: (id, data) => apiClient.patch(`/api/campus-events/${id}`, data),
  publish: (id) => apiClient.post(`/api/campus-events/${id}/publish`),
  delete: (id) => apiClient.delete(`/api/campus-events/${id}`),
};

export const notificationsApi = {
  getAll: (limit = 20, cursor, type) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    // Narrows the feed to one kind server-side (the Invitations tab). The
    // server allow-lists the value; anything else is ignored.
    if (type) params.set('type', type);
    return apiClient.get(`/api/notifications?${params.toString()}`);
  },
  getUnreadCount: () => apiClient.get('/api/notifications/unread-count'),
  markAsRead: (id) => apiClient.patch(`/api/notifications/${id}/read`),
  markAllAsRead: () => apiClient.patch('/api/notifications/read-all'),
  delete: (id) => apiClient.delete(`/api/notifications/${id}`),
};

export const searchApi = {
  globalSearch: (query, limit = 15, type = 'all', signal, cursor) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (type && type !== 'all') params.set('type', type);
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/search?${params.toString()}`, { signal });
  },
  getSuggestions: (query, signal) => {
    const params = new URLSearchParams({ q: query });
    return apiClient.get(`/api/search/suggestions?${params.toString()}`, { signal });
  },
  getRecentSearches: () => apiClient.get('/api/search/recent'),
  addRecentSearch: (term) => apiClient.post('/api/search/recent', { term }),
  removeRecentSearch: (term) => apiClient.delete(`/api/search/recent?term=${encodeURIComponent(term)}`),
  clearRecentSearches: () => apiClient.delete('/api/search/recent/clear'),
};


export const reportsApi = {
  /**
   * Submit a user/content report.
   * @param {string} targetType
   * @param {string} targetId
   * @param {string} reason
   * @param {string} [description]
   * @param {object} [metadata]
   */
  submit: (targetType, targetId, reason, description, metadata) =>
    apiClient.post('/api/reports', { targetType, targetId, reason, description, metadata }),
};

/**
 * Help centre and support requests.
 *
 * Every endpoint here is public. The support form has to work for someone who
 * cannot sign in — that is the whole point of it — so these calls must not
 * assume a session. `apiClient` attaches a token when one happens to exist and
 * omits it otherwise, which is exactly the behaviour needed.
 */
/**
 * The legal documents and this user's consent state.
 *
 * The two document reads are deliberately unauthenticated on the server, so
 * they work for a signed-out visitor on the public Terms page and for a signed-
 * in user who is blocked behind the consent modal — the one flow where every
 * other endpoint refuses.
 */
export const legalApi = {
  /** Published documents without their bodies. */
  listDocuments: ({ signal } = {}) =>
    apiClient.get('/api/legal/documents', { signal }),

  /** One published document, in full. */
  getDocument: (type, { signal } = {}) =>
    apiClient.get(`/api/legal/documents/${encodeURIComponent(type)}`, { signal }),

  /**
   * Whether this user may continue, and what is outstanding if not.
   * The authority for the gate — the cached profile is never more than a hint.
   */
  getConsentState: ({ signal } = {}) =>
    apiClient.get('/api/legal/consent', { signal }),

  /**
   * Records acceptance of every version the user was shown.
   *
   * Idempotent server-side, so a retry after a network failure is safe and does
   * not produce a second record.
   */
  acknowledge: (versionIds, { signal } = {}) =>
    apiClient.post('/api/legal/consent', { versionIds }, { signal }),

  /** This user's own record of what they accepted and when. */
  getConsentHistory: ({ signal } = {}) =>
    apiClient.get('/api/legal/consent/history', { signal }),
};

export const supportApi = {
  /** Category list and attachment rules, so the form never carries its own copy. */
  getFormMeta: ({ signal } = {}) => apiClient.get('/api/support/meta', { signal }),

  /** Published categories with their articles, plus the featured FAQ set. */
  getHelpCentre: ({ signal } = {}) => apiClient.get('/api/support/help', { signal }),

  searchHelp: (query, { signal } = {}) =>
    apiClient.get(`/api/support/help/search?q=${encodeURIComponent(query)}`, { signal }),

  submitRequest: (payload, { signal } = {}) => apiClient.post('/api/support/requests', payload, { signal }),
  submitSupportRequest: (payload, options) => supportApi.submitRequest(payload, options),

  /**
   * Uploads one attachment and returns its storage key.
   *
   * Uses fetch directly rather than `apiClient` because the body is multipart:
   * `request` sets a JSON content-type, which would stop the browser from
   * generating the multipart boundary.
   */
  uploadAttachment: async (file, { signal } = {}) => {
    const form = new FormData();
    form.append('file', file);

    const token = getToken();
    const res = await fetch(`${getBackendUrl()}/api/support/attachments`, {
      method: 'POST',
      body: form,
      signal,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });

    if (!res.ok) {
      let message = 'That file could not be uploaded.';
      try {
        const body = await res.json();
        if (body?.message) message = Array.isArray(body.message) ? body.message[0] : body.message;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }

    return res.json();
  },
};
