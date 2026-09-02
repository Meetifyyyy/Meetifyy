import { useQueryClient } from '@tanstack/react-query';
import { messagesApi, dmApi, groupApi, usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toast';
import { useConversations } from './useMessages';
import { processAndUploadImage, uploadFileDirect } from '../utils/mediaPipeline';
import { purgeConversationFromCaches, matchesConversationId, getConversationAliases } from '../../features/messages/shared/utils/cacheUtils';
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

  const updateMessagesCache = (convId, updater) => {
    queryClient.setQueryData(['messages', convId], (old) => {
      if (!old) return old;
      if (old.pages) {
        return {
          ...old,
          pages: old.pages.map((p, idx) => idx === 0 ? { ...p, messages: updater(p.messages || []) } : p)
        };
      }
      return { ...old, messages: updater(old.messages || []) };
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

    const tempId = options?.tempId || `temp_${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
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

    // Optimistically update cache
    updateMessagesCache(convId, (msgs) => [...msgs, optimisticMessage]);

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
        from: 'me',
        text: res.text || res.payload?.text || payload.text,
      };

      // Replace optimistic message with confirmed server message
      updateMessagesCache(convId, (msgs) => msgs.map(m => m.id === tempId ? confirmedMsg : m));
      return confirmedMsg;
    } catch (error) {
      // Rollback optimistic message on failure
      updateMessagesCache(convId, (msgs) => msgs.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
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
    }
  };


  return {
    updateMessagesCache,
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
