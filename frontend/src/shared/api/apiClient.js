/**
 * apiClient.js
 *
 * Central HTTP client for all backend API calls.
 * Automatically attaches the auth token from localStorage.
 */
import { supabase } from '@shared/context/AuthContext';

export const getBackendUrl = () => {
  const envUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (envUrl) {
    return envUrl;
  }
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    if (window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')) {
      return `${window.location.protocol}//${window.location.hostname}:4000`;
    }
  }
  return 'http://localhost:4000';
};

const BASE_URL = getBackendUrl();

async function getToken() {
  if (!supabase) return '';
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
}

async function request(method, path, body) {
  const token = await getToken();
  const deviceId = localStorage.getItem('meetifyy_deviceId');

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (deviceId) {
    headers['x-device-id'] = deviceId;
  }

  const options = { method, headers, cache: 'no-store' };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const cleanUrl = `${BASE_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  const res = await fetch(cleanUrl, options);

  if (res.status === 401) {
    // Only treat as a real session expiry if there's actually a live session.
    // 401s that happen during the login race-condition (session not yet persisted)
    // should not blow up the auth state.
    if (supabase) {
      const { data: { session: currentSession } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      if (currentSession) {
        await supabase.auth.signOut().catch(console.error);
        localStorage.removeItem('loggedIn');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('meetifyy_deviceId');
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
  // Globally sanitize dicebear initials avatars from backend responses
  const sanitizedText = text.replace(/https:\/\/api\.dicebear\.com\/7\.x\/initials\/[^"'\\]+/g, '');
  return JSON.parse(sanitizedText);
}

window.__api_redirecting = false;

export const apiClient = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
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
  getFeed: (limit = 10, cursor) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
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
  likePost: (postId) => apiClient.post(`/api/posts/${postId}/like`),

  /** Unlike a post by ID */
  unlikePost: (postId) => apiClient.post(`/api/posts/${postId}/unlike`),

  /**
   * Add a comment to a post.
   * @param {string} postId
   * @param {{ text: string, parentId?: string }} data
   */
  addComment: (postId, data) => apiClient.post(`/api/posts/${postId}/comments`, data),
  likeComment: (commentId) => apiClient.post(`/api/posts/comments/${commentId}/like`),
  unlikeComment: (commentId) => apiClient.post(`/api/posts/comments/${commentId}/unlike`),
  getPostById: (postId) => apiClient.get(`/api/posts/${postId}`),
  deletePost: (postId) => apiClient.delete(`/api/posts/${postId}`),

  voteInPoll: (postId, indices) => apiClient.post(`/api/posts/${postId}/vote`, { indices }),
  bookmarkPost: (postId) => apiClient.post(`/api/posts/${postId}/bookmark`),
  unbookmarkPost: (postId) => apiClient.delete(`/api/posts/${postId}/bookmark`),
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

export const communitiesApi = {
  getAll: () => apiClient.get('/api/communities'),
  getById: (id) => apiClient.get(`/api/communities/${id}`),
  create: (data) => apiClient.post('/api/communities', data),
  join: (id) => apiClient.post(`/api/communities/${id}/join`),
  leave: (id) => apiClient.post(`/api/communities/${id}/leave`),
  delete: (id) => apiClient.delete(`/api/communities/${id}`),
  updateGroupInfo: (id, data) => apiClient.patch(`/api/communities/${id}`, data),
  removeGroupMember: (id, memberId) => apiClient.delete(`/api/communities/${id}/members/${memberId}`),
};

export const activitiesApi = {
  getAll: () => apiClient.get('/api/activities'),
  getById: (id) => apiClient.get(`/api/activities/${id}`),
  create: (data) => apiClient.post('/api/activities', data),
  join: (id) => apiClient.post(`/api/activities/${id}/join`),
  leave: (id) => apiClient.post(`/api/activities/${id}/leave`),
  requestToJoinActivity: (id) => apiClient.post(`/api/activities/${id}/request`),
  acceptJoinRequest: (id, userId) => apiClient.post(`/api/activities/${id}/requests/${userId}/accept`),
  rejectJoinRequest: (id, userId) => apiClient.post(`/api/activities/${id}/requests/${userId}/reject`),
  declineCrewInvitation: (id) => apiClient.post(`/api/activities/${id}/decline`),
  endCrewActivity: (id) => apiClient.post(`/api/activities/${id}/end`),
};

export const usersApi = {
  getAll: (limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return apiClient.get(`/api/users?${params.toString()}`);
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
  follow: (username) => apiClient.post(`/api/users/${username}/follow`),
  unfollow: (username) => apiClient.post(`/api/users/${username}/unfollow`),
  getById: (id) => apiClient.get(`/api/users/id/${id}`),
  updateProfile: (data) => apiClient.patch('/api/users/me', data),
  getSettings: () => apiClient.get('/api/users/me/settings'),
  updateSettings: (data) => apiClient.patch('/api/users/me/settings', data),
  blockUser: (targetUserId) => apiClient.post(`/api/users/block/${targetUserId}`),
  unblockUser: (targetUserId) => apiClient.delete(`/api/users/block/${targetUserId}`),
};

export const messagesApi = {
  getConversations: () => apiClient.get('/api/messages'),
  getHistory: (conversationId, deviceId) => {
    const params = new URLSearchParams();
    if (deviceId) params.set('deviceId', deviceId);
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
  unsendMessage: (messageId) => apiClient.delete(`/api/messages/${messageId}`),
};

export const healthApi = {
  check: () => apiClient.get('/health'),
};

export const keysApi = {
  register: (payload) => apiClient.post('/api/keys/register', payload),
  getBundle: (userId) => apiClient.get(`/api/keys/bundle/${userId}`),
  getStatus: (deviceId) => apiClient.get(deviceId ? `/api/keys/status?deviceId=${encodeURIComponent(deviceId)}` : '/api/keys/status'),
  replenish: (payload) => apiClient.post('/api/keys/replenish', payload),
  rotateSpk: (payload) => apiClient.post('/api/keys/rotate-spk', payload),
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
  globalSearch: (query, limit = 10) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return apiClient.get(`/api/search?${params.toString()}`);
  }
};

export const uploadsApi = {
  /**
   * Request a presigned URL for direct browser → R2 uploads.
   * @param {string} filename - Original filename (used to determine extension)
   * @param {string} contentType - MIME type
   * @param {string} folder - R2 storage prefix, e.g. 'avatars', 'covers', 'chat-media'
   */
  presign: (filename, contentType, folder = 'general') =>
    apiClient.post('/api/uploads/presign', { filename, contentType, folder }),
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
