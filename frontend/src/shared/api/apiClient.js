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

export const getBackendUrl = () => {
  let rawEnv = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');

  if (rawEnv.includes('dev-api.meetifyy.app')) {
    rawEnv = 'https://meetifyy-production.up.railway.app';
  }

  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const isLocalIp = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|.+\.local$)/.test(host) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

    // In local development or on localhost/local IP, default to local NestJS backend at port 4000
    // when VITE_API_URL points to remote Railway/dev-api production server
    if ((isLocalHost || isLocalIp) && (import.meta.env.DEV || !rawEnv || rawEnv.includes('railway.app') || rawEnv.includes('meetifyy.app'))) {
      return `${protocol}//${host}:4000`;
    }

    // On HTTPS public hosts (e.g. Vercel), upgrade http:// backend URLs to https:// to prevent Mixed Content blocking
    if (rawEnv && protocol === 'https:' && !isLocalHost && !isLocalIp) {
      if (rawEnv.startsWith('http://') && !rawEnv.includes('localhost') && !rawEnv.includes('127.0.0.1')) {
        return rawEnv.replace(/^http:\/\//i, 'https://');
      }
    }
  }

  if (rawEnv) {
    if (!rawEnv.startsWith('http://') && !rawEnv.startsWith('https://')) {
      return `https://${rawEnv}`;
    }
    return rawEnv;
  }

  return 'http://127.0.0.1:4000';
};

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

  const bg = 'b6e3f4';

  let cleanUrl = url;
  if (cleanUrl.includes('backgroundColor=')) {
    cleanUrl = cleanUrl.replace(/backgroundColor=[^&]+/g, `backgroundColor=${bg}`);
  } else {
    const joinChar = cleanUrl.includes('?') ? '&' : '?';
    cleanUrl = `${cleanUrl}${joinChar}backgroundColor=${bg}`;
  }
  return cleanUrl;
};

export const getMediaUrl = (pathOrUrl) => {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';

  let finalUrl = pathOrUrl;

  if (finalUrl.includes('api.dicebear.com/')) {
    finalUrl = normalizeDicebearUrl(finalUrl);
  }

  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    if (!isLocalHost && !import.meta.env.VITE_API_URL) {
      finalUrl = finalUrl.replace(/^http:\/\/(?:localhost|127\.0\.0\.1):4000/g, `${window.location.protocol}//${host}:4000`);
    } else {
      finalUrl = finalUrl.replace(/^http:\/\/(?:localhost|127\.0\.0\.1):4000/g, getBackendUrl());
    }
  }

  if (finalUrl.startsWith('http://') || finalUrl.startsWith('https://') || finalUrl.startsWith('data:') || finalUrl.startsWith('blob:')) {
    return finalUrl;
  }
  const cleanPath = finalUrl.startsWith('/api/media/')
    ? finalUrl
    : `/api/media/${finalUrl.replace(/^\/+/, '')}`;
  const backendUrl = getBackendUrl();
  return `${backendUrl.replace(/\/+$/, '')}${cleanPath}`;
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

  const baseUrl = getBackendUrl();
  const cleanUrl = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

  // In-flight deduplication: GET requests only — share one promise per URL
  if (method === 'GET') {
    const inflightKey = cleanUrl;
    if (_inflight.has(inflightKey)) {
      return _inflight.get(inflightKey);
    }
    const promise = _doFetch(cleanUrl, options).finally(() => _inflight.delete(inflightKey));
    _inflight.set(inflightKey, promise);
    return promise;
  }

  return _doFetch(cleanUrl, options);
}

async function _doFetch(cleanUrl, options, isRetry = false) {
  const res = await fetch(cleanUrl, options);

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
    try {
      const errorBody = await res.json();
      errorMessage = errorBody?.message || errorMessage;
    } catch {
      // Non-JSON error body
    }
    throw new Error(errorMessage);
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

window.__api_redirecting = false;

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
  getCampusCommunities: () => apiClient.get('/api/communities/campus').then((list) => (Array.isArray(list) ? list.map(normalizeCommunity) : list)),
  getById: (id) => apiClient.get(`/api/communities/${id}`).then(normalizeCommunity),
  create: (data) => apiClient.post('/api/communities', data).then(normalizeCommunity),
  join: (id, { signal } = {}) => apiClient.post(`/api/communities/${id}/join`, undefined, { signal }),
  leave: (id, { signal } = {}) => apiClient.post(`/api/communities/${id}/leave`, undefined, { signal }),
  delete: (id) => apiClient.delete(`/api/communities/${id}`),
  updateGroupInfo: (id, data) => apiClient.patch(`/api/communities/${id}`, data).then(normalizeCommunity),
  removeGroupMember: (id, memberId) => apiClient.delete(`/api/communities/${id}/members/${memberId}`),
  getPendingRequests: (id) => apiClient.get(`/api/communities/${id}/requests`),
  getJoinRequests: (id) => apiClient.get(`/api/communities/${id}/requests`),
  acceptJoinRequest: (id, requestId) => apiClient.post(`/api/communities/${id}/requests/${requestId}/accept`),
  approveJoinRequest: (id, requestId) => apiClient.post(`/api/communities/${id}/requests/${requestId}/accept`),
  declineJoinRequest: (id, requestId) => apiClient.post(`/api/communities/${id}/requests/${requestId}/decline`),
};

export const activitiesApi = {
  getAll: (limit = 20, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/activities?${params.toString()}`);
  },
  getCampusActivities: (limit = 20, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/activities/campus?${params.toString()}`);
  },
  getMyActivities: () => apiClient.get('/api/activities/me'),
  getById: (id) => apiClient.get(`/api/activities/${id}`),
  create: (data) => apiClient.post('/api/activities', data),
  join: (id, { signal } = {}) => apiClient.post(`/api/activities/${id}/join`, undefined, { signal }),
  leave: (id, { signal } = {}) => apiClient.post(`/api/activities/${id}/leave`, undefined, { signal }),
  requestToJoinActivity: (id) => apiClient.post(`/api/activities/${id}/request`),
  acceptJoinRequest: (id, userId) => apiClient.post(`/api/activities/${id}/requests/${userId}/accept`),
  rejectJoinRequest: (id, userId) => apiClient.post(`/api/activities/${id}/requests/${userId}/reject`),
  cancelCrewActivity: (id) => apiClient.post(`/api/activities/${id}/cancel`),
  endCrewActivity: (id) => apiClient.post(`/api/activities/${id}/cancel`),
  inviteFriends: (id, userIds) => apiClient.post(`/api/activities/${id}/invite`, { userIds }),
  getPendingInvitations: () => apiClient.get('/api/activities/invitations/me'),
  acceptInvitation: (invitationId) => apiClient.post(`/api/activities/invitations/${invitationId}/accept`),
  declineInvitation: (invitationId) => apiClient.post(`/api/activities/invitations/${invitationId}/decline`),
  getInvitationStatuses: (id) => apiClient.get(`/api/activities/${id}/invitations/status`),
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
  }
};

export const notificationsApi = {
  getAll: (limit = 20, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiClient.get(`/api/notifications?${params.toString()}`);
  },
  getUnreadCount: () => apiClient.get('/api/notifications/unread-count'),
  markAsRead: (id) => apiClient.patch(`/api/notifications/${id}/read`),
  markAllAsRead: () => apiClient.patch('/api/notifications/read-all'),
  delete: (id) => apiClient.delete(`/api/notifications/${id}`),
};

export const searchApi = {
  globalSearch: (query, limit = 15, type = 'all', signal) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (type && type !== 'all') params.set('type', type);
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
