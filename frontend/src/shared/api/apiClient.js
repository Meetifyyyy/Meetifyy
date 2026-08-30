/**
 * apiClient.js
 *
 * Central HTTP client for all backend API calls.
 * Automatically attaches the auth token from localStorage.
 *
 * Token caching: we keep a module-level reference updated via onAuthStateChange
 * so every API call is a synchronous read — no async getSession() per request.
 */
import { supabase } from '@shared/lib/supabase';
import { config } from '@config';

// ── Token cache ──────────────────────────────────────────────────────────────
// Seeded on module load; refreshed instantly on every auth state change.
let _cachedToken = '';
let _hasSession = false;
let _initSessionPromise = null;

if (supabase) {
  // Seed immediately from stored session — keep reference so initial requests can await it
  _initSessionPromise = supabase.auth.getSession().then(({ data: { session } }) => {
    _cachedToken = session?.access_token ?? '';
    _hasSession = !!session;
    return session;
  }).catch(() => null);

  // Keep in sync with all future auth events (login, logout, token refresh)
  supabase.auth.onAuthStateChange((_event, session) => {
    _cachedToken = session?.access_token ?? '';
    _hasSession = !!session;
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

  // Stored media URLs may carry a localhost API origin from whichever machine
  // wrote them. Rewrite that prefix to the API origin this client actually uses.
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, protocol } = window.location;
    const localOriginPattern = new RegExp(`^https?://(?:localhost|127\\.0\\.0\\.1):${config.api.localPort}`, 'i');
    const replacement =
      !isLocalHost(hostname) && !config.api.baseUrl
        ? `${protocol}//${hostname}:${config.api.localPort}`
        : getBackendUrl();
    finalUrl = finalUrl.replace(localOriginPattern, replacement);
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

// Synchronous token read — O(1), no async overhead with localStorage fallback on boot
function getToken() {
  if (_cachedToken) return _cachedToken;

  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (token) {
              _cachedToken = token;
              _hasSession = true;
              return token;
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore storage parse exceptions
  }

  return '';
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

let _refreshPromise = null;

async function refreshSessionIfNeeded() {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data?.session) {
        const { data: sData } = await supabase.auth.getSession();
        if (sData?.session) {
          _cachedToken = sData.session.access_token;
          _hasSession = true;
          return sData.session;
        }
        return null;
      }
      _cachedToken = data.session.access_token;
      _hasSession = true;
      return data.session;
    } catch {
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

const PUBLIC_PATHS = [
  '/api/auth/verify-otp',
  '/api/auth/resend-otp',
  '/api/auth/signup',
  '/api/auth/login',
  '/api/health',
  // These are called during signup before the user has a session
  '/api/auth/check-username',
  '/api/auth/check-email',
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
];

function isPublicPath(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return PUBLIC_PATHS.some(p => clean === p || clean.startsWith(`${p}?`) || clean.startsWith(`${p}/`));
}

async function request(method, path, body, signal) {
  // If session seeding is in-flight on initial page load / reload, wait for it
  if (!_cachedToken && _initSessionPromise) {
    await _initSessionPromise;
  }

  const token = getToken(); // synchronous

  if (!token && !isPublicPath(path)) {
    throw new Error('Unauthorized: Missing access token');
  }

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
  const options = { method, headers, cache: method === 'GET' ? 'default' : 'no-store' };
  if (signal) options.signal = signal;
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

  // Store ETag from successful GET responses for future If-None-Match requests
  if (options.method === 'GET' && res.ok) {
    const etag = res.headers.get('ETag');
    if (etag) storeEtag(cleanUrl, etag);
  }

  if (res.status === 401 && !isRetry) {
    // Attempt automatic session refresh before declaring unauthorized
    const session = await refreshSessionIfNeeded();
    if (session?.access_token) {
      const retryHeaders = {
        ...options.headers,
        Authorization: `Bearer ${session.access_token}`
      };
      return _doFetch(cleanUrl, { ...options, headers: retryHeaders }, true);
    }

    // Only treat as a real session expiry if refresh truly failed AND we had a session
    if (supabase && _hasSession) {
      await supabase.auth.signOut().catch(console.error);
      _cachedToken = '';
      _hasSession = false;
      localStorage.removeItem('loggedIn');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('meetifyy_recent_searches');
      localStorage.removeItem('meetify_muted_communities');
      localStorage.removeItem('read_invitations');
      window.dispatchEvent(new Event('auth:unauthorized'));
      const onAuthPage = ['/auth', '/login', '/signup', '/forgot-password', '/reset-password'].some(p => window.location.pathname.startsWith(p));
      if (!onAuthPage && !window.__api_redirecting) {
        window.__api_redirecting = true;
        setTimeout(() => { window.__api_redirecting = false; }, 3000);
        window.location.href = '/login';
      }
    }
  }

  if (!res.ok) {
    let errorMessage = `API error ${res.status}`;
    let errorCode;
    try {
      const errorBody = await res.json();
      errorMessage = errorBody?.message || errorMessage;
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
  return JSON.parse(sanitizedText);
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
  get: (path, { signal } = {}) => request('GET', path, undefined, signal),
  post: (path, body, { signal } = {}) => request('POST', path, body, signal),
  patch: (path, body, { signal } = {}) => request('PATCH', path, body, signal),
  put: (path, body, { signal } = {}) => request('PUT', path, body, signal),
  delete: (path, { signal } = {}) => request('DELETE', path, undefined, signal),
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
  deletePost: (postId) => apiClient.delete(`/api/posts/${postId}`),

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
  getByUsername: (username) => apiClient.get(`/api/users/${username}`),
  getFollowers: (username, limit = 50, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get(`/api/users/${username}/followers?${params.toString()}`);
  },
  getFollowing: (username, limit = 50, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get(`/api/users/${username}/following?${params.toString()}`);
  },
  getFollowingUsernames: async (username) => {
    if (!username) return [];
    try {
      const res = await apiClient.get(`/api/users/${username}/following?limit=1000`);
      return Array.isArray(res) ? res.map(u => u?.username).filter(Boolean) : [];
    } catch {
      return [];
    }
  },
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
  startInstantMatch: (targetUserId, activity) => apiClient.post('/api/dm/instant-match', { targetUserId, activity }),
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



export const messagesApi = {
  getConversations: (limit, offset) => {
    const params = new URLSearchParams();
    const resolvedLimit = typeof limit === 'number' ? limit : (typeof limit === 'object' && typeof limit?.limit === 'number' ? limit.limit : 20);
    const resolvedOffset = typeof offset === 'number' ? offset : (typeof limit === 'object' && typeof limit?.offset === 'number' ? limit.offset : 0);
    
    if (resolvedLimit) params.set('limit', String(resolvedLimit));
    if (resolvedOffset) params.set('offset', String(resolvedOffset));
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
  startInstantMatchChat: (targetUserId, activity) => apiClient.post('/api/messages/instant-match', { targetUserId, activity }),
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
