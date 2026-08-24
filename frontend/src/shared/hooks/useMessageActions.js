import { useQueryClient } from '@tanstack/react-query';
import { messagesApi, dmApi, groupApi, usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toast';
import { useConversations } from './useMessages';
import { processAndUploadImage, uploadFileDirect } from '../utils/mediaPipeline';
import { purgeConversationFromCaches } from '../../features/messages/shared/utils/cacheUtils';
import { idbDeleteConversationMessages } from '../../features/messages/shared/utils/idbMessages';

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



  const toggleMuteConversation = async (convId, currentMuted) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => c.id === convId || c.publicId === convId ? { ...c, isMuted: !currentMuted } : c);
    });
    try {
      await messagesApi.muteConversation(convId, !currentMuted);
    } catch (e) {
      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(c => c.id === convId || c.publicId === convId ? { ...c, isMuted: currentMuted } : c);
      });
    }
  };

  const deleteConversation = async (convId) => {
    // One shared purge for every surface: the list row, every cached message
    // history under any of the conversation's id aliases, and the offline
    // mirror. Deletion is per-user — the other participant's copy is untouched.
    const aliases = purgeConversationFromCaches(queryClient, convId, conversations);
    idbDeleteConversationMessages(aliases).catch(() => {});
    try {
      await messagesApi.deleteConversation(convId);
    } catch (e) {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  };

  const clearChat = async (convId) => {
    queryClient.setQueryData(['messages', convId], () => ({ pages: [], pageParams: [] }));
    try {
      await messagesApi.clearChat(convId);
    } catch (e) {
      console.error(e);
    }
  };
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
