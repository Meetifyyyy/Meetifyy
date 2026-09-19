import { useQueryClient } from '@tanstack/react-query';
import { messagesApi, dmApi, groupApi, usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toast';
import { useConversations } from './useMessages';
import { processAndUploadImage, uploadFileDirect } from '../utils/mediaPipeline';
import { purgeConversationFromCaches, matchesConversationId, getConversationAliases, appendMessageToCache } from '../../features/messages/shared/utils/cacheUtils';
import { idbDeleteConversationMessages } from '../../features/messages/shared/utils/idbMessages';
import { scheduleConversationWrite } from '../utils/conversationWriteQueue';

/**
 * Cache key holding "have I blocked this person?" for a draft DM.
 *
 * Keyed by user id, because a draft has no conversation id worth keying on.
 */
export const dmBlockStateKey = (userId) => ['dmBlockState', userId];

/**
 * The direct-message / conversation actions `useData` used to define inline.
 *
 * Extracted verbatim -- same optimistic cache writes, same API calls, same
 * error handling, carried over from the former `useData` mega-hook.
 */
export function useMessageActions() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { conversations } = useConversations();

  /**
   * Every cache key this conversation answers to.
   *
   * A conversation is addressable by several ids — its internal id, its public
   * id, the other participant's id or username, with or without the `c_`
   * prefix — and `['messages', <id>]` is keyed on whichever one the open route
   * happens to use. Writing to the single id a share modal was holding put the
   * message under a key the chat was not reading, so it was invisible until a
   * refetch. This is the same alias set the socket handler writes to.
   */
  const conversationKeys = (convId) => {
    const conv = (conversations || []).find((c) => matchesConversationId(c, convId));
    return [...new Set([String(convId), ...getConversationAliases(conv)])].filter(Boolean);
  };

  /**
   * Writes a message into every key the conversation answers to.
   *
   * `createIfMissing` matters more than it looks. The previous helper opened
   * with `if (!old) return old`, so when the conversation's messages had never
   * been fetched — the normal case when sharing from the feed — BOTH the
   * optimistic write and the confirmed one were silently dropped, and the
   * message existed only on the server.
   *
   * `appendMessageToCache` is idempotent: it matches on id, clientId and
   * tempId, so the optimistic copy, the HTTP response and the socket echo all
   * collapse onto one entry however they interleave.
   */
  const writeMessageToCaches = (convId, message, { createIfMissing = false } = {}) => {
    conversationKeys(convId).forEach((key) => {
      appendMessageToCache(queryClient, key, message, { createIfMissing });
    });
  };

  /** Marks a pending message failed, across the same keys. */
  const markMessageFailed = (convId, clientId) => {
    conversationKeys(convId).forEach((key) => {
      queryClient.setQueryData(['messages', key], (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            messages: (p.messages || []).map((m) =>
              m.clientId === clientId || m.tempId === clientId || m.id === clientId
                ? { ...m, status: 'failed' }
                : m,
            ),
          })),
        };
      });
    });
  };
  // API Implementations
  const sendDirectMessage = async (convId, text, replyTo = null, mentions = [], mediaUrl = null, mediaType = null, explicitLinkPreview = null, explicitInviteData = null, options = null) => {
    let payload = {};
    if (text && typeof text === 'object' && !Array.isArray(text)) {
      payload = text;
    } else {
      payload = {
        text: typeof text === 'string' ? text : '',
        replyToId: replyTo?.id || null,
        mentions: Array.isArray(mentions) ? mentions : [],
        mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : null,
        mediaType: typeof mediaType === 'string' ? mediaType : null,
        inviteData: explicitInviteData || (mentions && typeof mentions === 'object' && !Array.isArray(mentions) ? mentions : null)
      };
    }

    /**
     * One id for this send, carried end to end.
     *
     * It goes in the request, the server stores it on `clientMessageId` and
     * echoes it back, and the socket echo carries it too — so the optimistic
     * copy, the HTTP response and the realtime event all collapse onto one
     * entry however they interleave. It is also the idempotency key: a retried
     * send returns the message already stored instead of writing a second one.
     *
     * `Date.now()` alone was not unique enough to be either — two sends in the
     * same millisecond, which a multi-recipient share does routinely, produced
     * the same id.
     */
    const tempId =
      options?.tempId ||
      `temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    payload.clientId = tempId;

    const optimisticMessage = {
      id: tempId,
      clientId: tempId,
      tempId,
      conversationId: convId,
      text: payload.text,
      mediaUrl: payload.mediaUrl,
      mediaType: payload.mediaType,
      mentions: payload.mentions,
      inviteData: payload.inviteData,
      replyTo,
      senderId: currentUser?.id,
      senderName: currentUser?.displayName || currentUser?.username,
      senderAvatar: currentUser?.avatar,
      from: 'me',
      status: 'sending',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    };

    // Seeds the cache when the conversation has never been opened, which is the
    // normal case for a share sent from the feed.
    writeMessageToCaches(convId, optimisticMessage, { createIfMissing: true });

    try {
      if (options?.fileObj) {
        const file = options.fileObj;
        if (file.type.startsWith('image/')) {
          const { publicUrl } = await processAndUploadImage(file, 'chat');
          payload.mediaUrl = publicUrl;
        } else {
          const { publicUrl } = await uploadFileDirect(file, 'chat');
          payload.mediaUrl = publicUrl;
        }
      }


      let res;
      if (String(convId).startsWith('c_')) {
        res = await groupApi.sendMessage(String(convId).replace('c_', ''), payload);
      } else {
        res = await dmApi.sendMessage(convId, payload);
      }
      
      const confirmedMsg = {
        ...res,
        // Kept so the merge can find the optimistic entry even on an older API
        // that does not echo the field back.
        clientId: res.clientId || tempId,
        tempId: res.tempId || tempId,
        from: 'me',
        status: res.status || 'sent',
        text: res.text || res.payload?.text || payload.text,
      };

      // Merges onto the optimistic entry by clientId rather than appending.
      writeMessageToCaches(convId, confirmedMsg, { createIfMissing: true });
      return confirmedMsg;
    } catch (error) {
      markMessageFailed(convId, tempId);
      throw error;
    } finally {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  };

  const normalizeUserIds = (input) => {
    if (Array.isArray(input)) {
      return input.map(item => typeof item === 'string' ? item : (item?.id || item?.userId)).filter(Boolean);
    }
    if (typeof input === 'string') return [input];
    if (typeof input === 'object' && (input.id || input.userId)) return [input.id || input.userId];
    return [];
  };
  const reactToMessage = (messageId, reaction) => messagesApi.reactToMessage(messageId, reaction);

  const startConversation = (targetUserOrIds, name) => {
    let targetUserObj = typeof targetUserOrIds === 'object' && !Array.isArray(targetUserOrIds) ? targetUserOrIds : null;
    const cleanIds = normalizeUserIds(targetUserOrIds);
    const targetUserId = targetUserObj?.id || (Array.isArray(cleanIds) ? cleanIds[0] : cleanIds);

    const existingConv = (conversations || []).find(c => {
      if (c.isGroup || String(c.id).startsWith('c_')) return false;
      const otherId = c.targetUser?.id || c.otherUser?.id || c.userId || c.participants?.find(p => {
        const pId = typeof p === 'string' ? p : (p.id || p.userId || p.user?.id);
        return String(pId) !== String(currentUser?.id);
      })?.userId;
      return String(otherId) === String(targetUserId);
    });

    if (existingConv) {
      return existingConv.publicId || existingConv.id;
    }

    return `draft_${targetUserId}`;
  };

  const createGroupConversation = async (groupName, userIds) => {
    const cleanIds = normalizeUserIds(userIds);

    try {
      const res = await groupApi.createGroup(groupName, cleanIds);
      const realId = res?.publicId || res?.id;
      if (!realId) throw new Error('No conversation ID returned');

      // Inject the real group into the conversation list immediately.
      // The socket will also send conversation:updated to all members,
      // but we pre-populate here so the UI is instant for the creator.
      const newConv = {
        ...res,
        id: realId,
        publicId: realId,
        internalId: res.internalId || realId,
        isGroup: true,
        type: 'GROUP',
        unread: 0,
        unreadCount: 0,
        timestamp: Date.now(),
        updatedAt: res.updatedAt || new Date().toISOString(),
      };

      queryClient.setQueryData(['conversations'], (old) => {
        const list = Array.isArray(old) ? old : [];
        // Remove any stale entry with same ID before injecting
        const filtered = list.filter(c => c.id !== realId && c.publicId !== realId);
        return [newConv, ...filtered];
      });

      return realId;
    } catch (err) {
      console.error('Failed to create group:', err);
      showToast("Couldn't create group", 'error');
      return null;
    }
  };



  /**
   * Mute/unmute a conversation for the current user.
   *
   * Two things this has to get right, both of which it used to get wrong:
   *
   * 1. It writes `muted` as well as `isMuted`. The server returns the flag as
   *    `muted`, and every consumer — the context menus, the chat header, the
   *    toast suppression in SocketManager — reads `muted` first. Patching only
   *    `isMuted` left the label and the bell icon showing the old state until
   *    the next full refetch, so the tap looked like it had done nothing.
   * 2. It tolerates being called without `currentMuted`, resolving the current
   *    value from the cache, so callers that only have a conversation id
   *    cannot accidentally toggle to the state it is already in.
   */
  const toggleMuteConversation = async (convId, currentMuted) => {
    let isMutedNow = currentMuted;
    if (typeof isMutedNow !== 'boolean') {
      const cached = queryClient.getQueryData(['conversations']);
      if (Array.isArray(cached)) {
        const found = cached.find(c => matchesConversationId(c, convId));
        if (found) isMutedNow = Boolean(found.muted ?? found.isMuted);
      }
    }
    isMutedNow = Boolean(isMutedNow);
    const nextMuted = !isMutedNow;

    const writeMuted = (value) => {
      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(c => matchesConversationId(c, convId) ? { ...c, muted: value, isMuted: value } : c);
      });
    };

    writeMuted(nextMuted);

    // Rapid taps: the UI follows every one of them (above), but only the
    // settled state is sent. Without this a double-tap fires mute then unmute
    // as two racing requests, and whichever lands second wins — which is not
    // necessarily the one the user finished on.
    scheduleConversationWrite(`mute:${convId}`, async () => {
      const latest = queryClient.getQueryData(['conversations']);
      const row = Array.isArray(latest) ? latest.find(c => matchesConversationId(c, convId)) : null;
      const desired = row ? Boolean(row.muted ?? row.isMuted) : nextMuted;
      try {
        await messagesApi.muteConversation(convId, desired);
      } catch (e) {
        writeMuted(isMutedNow);
        showToast(desired ? "Couldn't mute alerts" : "Couldn't unmute alerts", 'error');
      }
    });
  };

  const deleteConversation = async (convId) => {
    // One shared purge for every surface: the list row, every cached message
    // history under any of the conversation's id aliases, and the offline
    // mirror. Deletion is per-user — the other participant's copy is untouched.
    //
    // The row is snapshotted first so a failed request can put it back. Without
    // that the optimistic removal was permanent-looking on failure until a
    // refetch happened to run, and the invalidate alone could not restore a
    // conversation the server still had while the list query was fresh.
    const snapshot = (queryClient.getQueryData(['conversations']) || [])
      .find(c => matchesConversationId(c, convId));
    const aliases = purgeConversationFromCaches(queryClient, convId, conversations);
    idbDeleteConversationMessages(aliases).catch(() => {});
    try {
      await messagesApi.deleteConversation(convId);
    } catch (e) {
      if (snapshot) {
        queryClient.setQueryData(['conversations'], (old) => {
          const list = Array.isArray(old) ? old : [];
          if (list.some(c => matchesConversationId(c, convId))) return list;
          return [snapshot, ...list];
        });
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      showToast("Couldn't delete chat", 'error');
    }
  };

  /**
   * Clear a chat for the current user only.
   *
   * The message list, the media gallery (derived from the same cached
   * messages) and the offline mirror all have to go at once. Leaving IndexedDB
   * populated was enough on its own to bring every "cleared" message back on
   * the next cold load, because the local mirror is read before the network.
   *
   * The list row itself stays — that is the whole difference between Clear and
   * Delete — but its preview is blanked so the row does not keep advertising a
   * message the user can no longer open.
   */
  const clearChat = async (convId) => {
    const conv = (conversations || []).find(c => matchesConversationId(c, convId));
    const aliases = new Set([String(convId), ...getConversationAliases(conv)]);

    const previousMessages = new Map();
    aliases.forEach((alias) => {
      previousMessages.set(alias, queryClient.getQueryData(['messages', alias]));
      queryClient.setQueryData(['messages', alias], { pages: [], pageParams: [] });
    });
    const previousRow = (queryClient.getQueryData(['conversations']) || [])
      .find(c => matchesConversationId(c, convId));

    // `lastMessage` must be nulled, not just the flat `lastMsg`/`lastMessageText`
    // aliases. useMessages derives the row preview by falling through
    // `lastMsg → lastMessageText → lastMessage.text`, so blanking only the
    // first two let the chain fall through to the structured object and put
    // the cleared message straight back on the row.
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => matchesConversationId(c, convId)
        ? {
            ...c,
            lastMessage: null,
            lastMsg: '',
            lastMessageText: '',
            lastMessageType: null,
            lastSenderId: null,
            unread: 0,
            unreadCount: 0,
          }
        : c);
    });

    idbDeleteConversationMessages([...aliases]).catch(() => {});

    try {
      await messagesApi.clearChat(convId);
    } catch (e) {
      previousMessages.forEach((data, alias) => {
        if (data) queryClient.setQueryData(['messages', alias], data);
      });
      if (previousRow) {
        queryClient.setQueryData(['conversations'], (old) => {
          if (!Array.isArray(old)) return old;
          return old.map(c => matchesConversationId(c, convId) ? previousRow : c);
        });
      }
      queryClient.invalidateQueries({ queryKey: ['messages', String(convId)] });
      showToast("Couldn't clear chat", 'error');
    }
  };
  /**
   * Block state for a DM that has no conversation row yet.
   *
   * Every other surface reads `isBlockedByMe` off the conversation, which comes
   * from the ['conversations'] cache. A draft is not in that cache and never
   * will be until the first message creates it, so the optimistic write below
   * matched nothing and blocking from an empty chat left the composer enabled
   * and the menu still offering "Block Contact" — the request succeeded and the
   * UI simply never heard about it.
   *
   * Refetching the user instead is not an option: `GET /api/users/id/:id`
   * deliberately 404s once a block exists (a blocked profile must be
   * indistinguishable from a missing one), so the very act of blocking would
   * erase the recipient the draft is built from.
   *
   * So the state lives here, keyed by the person rather than by a conversation
   * that does not exist. MessagesLayout reads it when it builds the draft.
   */
  const toggleBlockUser = async (targetUserId, currentlyBlocked) => {
    // Callers used to invoke this with no arguments at all, which sent
    // POST /api/users/block/undefined. That request failed, the failure was
    // swallowed below, and the optimistic write left the UI claiming a block
    // that the server had never recorded — the user saw "Blocked" while
    // messages kept arriving. Refuse to act on a target we cannot identify.
    if (typeof targetUserId !== 'string' || !targetUserId) {
      console.error('toggleBlockUser called without a target user id');
      showToast("Couldn't update block status", 'error');
      return;
    }

    const wasBlocked = Boolean(currentlyBlocked);

    const applyBlockState = (blockedByMe) => {
      // Drafts, keyed by user. See the note above toggleBlockUser.
      queryClient.setQueryData(dmBlockStateKey(targetUserId), { isBlockedByMe: blockedByMe });

      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(c => {
          if (c.targetUser?.id === targetUserId || c.userId === targetUserId) {
            return {
              ...c,
              // `blocked` is the mutual answer: the thread is closed for writes
              // if either side blocked. Preserve isBlockedByThem — whether they
              // blocked me is independent of what I just did, and overwriting it
              // with false re-opened an input that must stay closed.
              blocked: blockedByMe || Boolean(c.isBlockedByThem),
              isBlockedByMe: blockedByMe,
            };
          }
          return c;
        });
      });
    };

    // Optimism only ever moves toward MORE restriction. Blocking locks the
    // composer immediately; unblocking waits for the server.
    //
    // Optimistically unlocking is what produced the reported flash: the other
    // user may still be blocking you, so clearing the state locally showed a
    // usable input for the length of one refetch before the server's answer put
    // the lock straight back.
    if (!wasBlocked) applyBlockState(true);

    try {
      if (wasBlocked) {
        await usersApi.unblockUser(targetUserId);
        // Unblocking is confirmed rather than optimistic, so the draft's state
        // is cleared here rather than up front. A real conversation gets the
        // same correction from the refetch in `finally`; a draft has nothing to
        // refetch, which is why this is explicit.
        applyBlockState(false);
      } else {
        await usersApi.blockUser(targetUserId);
      }
    } catch (err) {
      // Put the UI back where the server actually is, and say so. Silently
      // keeping the optimistic value is what made a failed block look like a
      // successful one.
      if (!wasBlocked) applyBlockState(false);
      // Surface what the server actually said. A bare "Couldn't block this
      // user" hides the reason from the user AND from anyone debugging it —
      // the API already returns a specific message, so pass it through.
      const reason = err?.message && !/^API error \d+$/.test(err.message) ? err.message : null;
      showToast(
        reason || (wasBlocked ? "Couldn't unblock this user" : "Couldn't block this user"),
        'error',
      );
      console.error('block/unblock failed', { targetUserId, wasBlocked, status: err?.status, message: err?.message });
      return;
    } finally {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // Blocking deletes both Follow rows in the same transaction, so any
      // follower/following list on screen is stale the moment it returns.
      // Keyed by username, so refetch every instance rather than guessing.
      queryClient.invalidateQueries({ queryKey: ['followers'] });
      queryClient.invalidateQueries({ queryKey: ['following'] });
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });

      /**
       * Everywhere the other person's content can still be sitting in cache.
       *
       * The lists above cover the relationship; these cover the content. A
       * block takes effect server-side immediately, but a feed already in
       * memory keeps painting the posts it was handed — so without this the
       * person stays visible until something else happens to refetch, which on
       * a quiet screen can be indefinitely. Blocking someone and still seeing
       * their posts is the one outcome this feature cannot have.
       *
       * Broad on purpose: the keys are refetched, not dropped, and the cost of
       * a few extra requests at the moment someone blocks is not worth the
       * precision of enumerating every variant key.
       */
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post'] });
      queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      queryClient.invalidateQueries({ queryKey: ['community'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['search'] });
    }
  };


  return {
    /**
     * Exported for the same reason it always was, but it is now the
     * alias-aware writer rather than the single-key one. No caller uses it
     * today; it stays on the surface so a future one gets the correct
     * behaviour rather than reinventing the version that dropped writes.
     */
    writeMessageToCaches,
    toggleMuteConversation,
    deleteConversation,
    clearChat,
    toggleBlockUser,
    sendDirectMessage,
    reactToMessage,
    startConversation,
    createGroupConversation,
  };
}
