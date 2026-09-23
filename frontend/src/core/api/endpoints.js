/**
 * Meetifyy API endpoints — every route the clients call, in one place.
 *
 * WHAT THIS IS
 * A factory, not a module of singletons. `createEndpoints` is handed a
 * transport and returns the namespaces bound to it, so the same endpoint
 * definitions can serve the web app, the Capacitor app and — later — a React
 * Native one, each with its own transport, its own auth storage and its own
 * base URL. Nothing here is shared between clients at runtime; only the
 * DEFINITIONS are.
 *
 * WHY IT MOVED HERE
 * These 21 namespaces used to sit at the bottom of `shared/api/apiClient.js`,
 * below ~970 lines of transport that reaches into Supabase, the config object,
 * the legal-consent bus and the account-status correction — none of which a
 * second client can take. The endpoints themselves needed none of it: they
 * reference exactly three things from the transport (`apiClient`, `getToken`,
 * `getBackendUrl`) and not one browser global. Splitting on that line is what
 * makes the portable half portable.
 *
 * WHAT IT MAY NOT DO
 * `src/core/**` is lint-enforced against DOM access, `import.meta.env`, React,
 * routers, and imports back into client code. If something here needs a device
 * capability, it takes it through `platform/contracts.ts`; if it needs
 * configuration, the transport was constructed with it.
 *
 * The bodies below are unchanged from the file they came from, deliberately:
 * this is a move, not a rewrite, and `dist/assets` is expected to be
 * byte-identical afterwards.
 */

/**
 * @param {object} transport
 * @param {{get,post,patch,put,delete}} transport.apiClient  verb helpers
 * @param {() => string} transport.getToken                  current access token, may be ''
 * @param {() => string} transport.getBackendUrl             absolute API origin
 */
export function createEndpoints({ apiClient, getToken, getBackendUrl }) {
  const authApi = {
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
    adoptSession: (refreshToken, { bearer } = {}) =>
      apiClient.post('/api/auth/session/adopt', { refreshToken }, { bearer }),

    /**
     * Ends this device's session server-side and clears its cookies.
     *
     * Without this, signing out was a purely local act: the row stayed live and
     * the cookies stayed in the browser, so the next reload signed the person
     * back in — and on a shared machine, signed the next person in as them.
     */
    logoutSession: () => apiClient.post('/api/auth/session/logout'),
  };

  const postsApi = {
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
  const shareApi = {
    /**
     * Rejects with `status === 404` for a post that is not publicly shareable —
     * deleted, private, in a restricted community, by an unavailable author, or
     * simply not a post. The server answers all of those identically on purpose,
     * so callers must not try to tell them apart.
     */
    getPublicPost: (postId, { signal } = {}) =>
      apiClient.get(`/api/share/post/${encodeURIComponent(postId)}`, { signal }),
  };

  const linkPreviewApi = {
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

  const communitiesApi = {
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

  const activitiesApi = {
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
  const sessionsApi = {
    list: () => apiClient.get('/api/auth/sessions'),
    revoke: (id) => apiClient.delete(`/api/auth/sessions/${id}`),
    /** Signs out every other device, leaving this one alone. */
    revokeOthers: () => apiClient.post('/api/auth/sessions/revoke-all', { scope: 'others' }),
  };

  const usersApi = {
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
    // `bearer` only for the signup handover; see `request` in transport.js.
    updateProfile: (data, { bearer } = {}) => apiClient.patch('/api/users/me', data, { bearer }),
    getSettings: () => apiClient.get('/api/users/me/settings'),
    updateSettings: (data) => apiClient.patch('/api/users/me/settings', data),
    blockUser: (targetUserId) => apiClient.post(`/api/users/block/${targetUserId}`),
    unblockUser: (targetUserId) => apiClient.delete(`/api/users/block/${targetUserId}`),
  };

  const dmApi = {
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

  const groupApi = {
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
  const instantMatchApi = {
    getState: () => apiClient.get('/api/instant-match/state'),
  };

  const messagesApi = {
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

  const healthApi = {
    check: () => apiClient.get('/health'),
  };

  const uploadsApi = {
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
  const campusEventsApi = {
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

  const notificationsApi = {
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

  const searchApi = {
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


  const reportsApi = {
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
  const legalApi = {
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

  const supportApi = {
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
  return {
    authApi,
    postsApi,
    shareApi,
    linkPreviewApi,
    communitiesApi,
    activitiesApi,
    sessionsApi,
    usersApi,
    dmApi,
    groupApi,
    instantMatchApi,
    messagesApi,
    healthApi,
    uploadsApi,
    campusEventsApi,
    notificationsApi,
    searchApi,
    reportsApi,
    legalApi,
    supportApi,
  };
}
