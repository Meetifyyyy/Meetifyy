/**
 * useMessages — feature-scoped hook for conversation data.
 *
 * Owns the conversations list query and exposes all messaging mutations.
 * NOT persisted to IndexedDB (active chat state should never be stale across sessions).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { messagesApi, activitiesApi, groupApi, communitiesApi, usersApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';

// ── Query keys ───────────────────────────────────────────────────────────────
export const MESSAGE_KEYS = {
  conversations: ['conversations'],
  history: (convId) => ['messages', convId],
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetches and transforms the conversation list.
 * Deliberately short staleTime — conversations should stay fresh (unread counts, last message).
 */
export function useConversations() {
  const { currentUser, isLoggedIn } = useAuth();

  const { data: rawConversations = [], isLoading, error } = useQuery({
    queryKey: MESSAGE_KEYS.conversations,
    queryFn: () => messagesApi.getConversations(50, 0),
    enabled: Boolean(isLoggedIn || currentUser?.id),
    staleTime: 60 * 1000,   // 60s
    gcTime:    5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const conversations = useMemo(() => {
    const list = (rawConversations || []).map((c) => {
      const pList = c.participants || c.members || [];
      const calculatedIsMember = (!c.type || c.type === 'DIRECT')
        ? true
        : pList.some((p) => {
            const id = typeof p === 'string' ? p : (p.id || p.userId);
            return String(id) === String(currentUser?.id);
          });
      const isMember = c.isMember !== undefined ? c.isMember : calculatedIsMember;
      const isGroup = c.type === 'GROUP' || c.type === 'ACTIVITY' || !!c.isGroup || !!c.isActivityChat || Boolean(c.activityId);

      const computedTimestamp = (() => {
        const times = [
          c.timestamp,
          c.lastMessage?.createdAt ? new Date(c.lastMessage.createdAt).getTime() : 0,
          c.updatedAt ? new Date(c.updatedAt).getTime() : 0
        ].filter(Boolean);
        return times.length > 0 ? Math.max(...times) : 0;
      })();

      return {
        ...c,
        internalId: c.internalId || c.id,
        isMember,
        isGroup,
        blocked: c.blocked || false,
        isBlockedByMe: c.isBlockedByMe || false,
        isBlockedByThem: c.isBlockedByThem || false,
        lastMsg: (() => {
          if (c.lastMsg) return c.lastMsg;
          if (c.lastMessageText) return c.lastMessageText;
          if (!c.lastMessage) return '';
          if (c.lastMessage.text) return c.lastMessage.text;
          if (c.lastMessage.mediaUrl) {
            if (c.lastMessage.mediaType === 'image') return 'Photo';
            if (c.lastMessage.mediaType === 'video') return 'Video';
            return 'Audio';
          }
          return '';
        })(),
        lastSenderId: c.lastMessage?.senderId || null,
        timestamp: computedTimestamp,
        unread: c.unreadCount || c.unread || 0,
        online: isGroup ? false : Boolean(c.targetUser ? c.targetUser.isOnline : (c.isOnline ?? c.online ?? false)),
        isOnline: isGroup ? false : Boolean(c.targetUser ? c.targetUser.isOnline : (c.isOnline ?? c.online ?? false)),
        name: isGroup ? (c.name || 'Group Chat') : (c.name || c.targetUser?.displayName || c.targetUser?.username || 'Chat'),
        avatar: isGroup ? (c.avatarKey || c.avatar || (c.activity?.coverImage || null)) : (c.avatar || c.targetUser?.avatar || null),
        username: isGroup ? null : (c.targetUser?.username || null),
        userId: isGroup ? null : (c.targetUser?.id || null),
        targetUser: isGroup ? null : c.targetUser,
      };
    });

    return [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [rawConversations, currentUser?.id]);

  return {
    conversations,
    rawConversations,
    isLoading,
    error,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * All messaging mutations in one place. Components call these directly
 * instead of going through useData.
 */
export function useMessageMutations() {
  const queryClient = useQueryClient();

  const invalidateConversations = () =>
    queryClient.invalidateQueries({ queryKey: MESSAGE_KEYS.conversations });

  function updateMessagesCache(convId, updater) {
    queryClient.setQueryData(MESSAGE_KEYS.history(convId), (old) => {
      if (!old) return old;
      if (old.pages) {
        return {
          ...old,
          pages: old.pages.map((p, idx) =>
            idx === 0 ? { ...p, messages: updater(p.messages || []) } : p
          ),
        };
      }
      return { ...old, messages: updater(old.messages || []) };
    });
  }

  const togglePinConversation = async (convId, currentPinned) => {
    const nextPinned = !currentPinned;
    queryClient.setQueryData(MESSAGE_KEYS.conversations, (old) =>
      Array.isArray(old)
        ? old.map((c) =>
            c.id === convId || c.publicId === convId
              ? { ...c, isPinned: nextPinned, pinned: nextPinned }
              : c
          )
        : old
    );
    try {
      await messagesApi.pinConversation(convId, nextPinned);
    } catch {
      invalidateConversations();
    }
  };

  const toggleMuteConversation = async (convId, currentMuted) => {
    queryClient.setQueryData(MESSAGE_KEYS.conversations, (old) =>
      Array.isArray(old)
        ? old.map((c) =>
            c.id === convId || c.publicId === convId ? { ...c, isMuted: !currentMuted } : c
          )
        : old
    );
    try {
      await messagesApi.muteConversation(convId, !currentMuted);
    } catch {
      invalidateConversations();
    }
  };

  const deleteConversation = async (convId) => {
    queryClient.setQueryData(MESSAGE_KEYS.conversations, (old) =>
      Array.isArray(old) ? old.filter((c) => c.id !== convId && c.publicId !== convId) : old
    );
    try {
      await messagesApi.deleteConversation(convId);
    } catch {
      invalidateConversations();
    }
  };

  const clearChat = async (convId) => {
    queryClient.setQueryData(MESSAGE_KEYS.history(convId), () => ({ pages: [], pageParams: [] }));
    await messagesApi.clearChat(convId).catch(console.error);
  };

  const toggleBlockUser = async (targetUserId, currentlyBlocked) => {
    queryClient.setQueryData(MESSAGE_KEYS.conversations, (old) =>
      Array.isArray(old)
        ? old.map((c) =>
            c.targetUser?.id === targetUserId || c.userId === targetUserId
              ? { ...c, blocked: !currentlyBlocked, isBlockedByMe: !currentlyBlocked, isBlockedByThem: false }
              : c
          )
        : old
    );
    if (currentlyBlocked) {
      await usersApi.unblockUser(targetUserId).catch(() => {});
    } else {
      await usersApi.blockUser(targetUserId).catch(() => {});
    }
    invalidateConversations();
  };

  const leaveGroup = async (convId) => {
    if (String(convId).startsWith('c_')) {
      const actualId = convId.replace('c_', '');
      return communitiesApi.leave(actualId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['communities'] }))
        .catch(() => {});
    }
    if (String(convId).startsWith('act_')) {
      const actualId = convId.replace('act_', '');
      return activitiesApi.leave(actualId).then(() => {
        queryClient.invalidateQueries({ queryKey: ['activities'] });
        invalidateConversations();
      });
    }
    await groupApi.leaveGroup(convId).catch(() => {});
    invalidateConversations();
  };

  const endGroup = async (convId) => {
    await messagesApi.endGroup(convId);
    invalidateConversations();
  };

  return {
    updateMessagesCache,
    togglePinConversation,
    toggleMuteConversation,
    deleteConversation,
    clearChat,
    toggleBlockUser,
    leaveGroup,
    endGroup,
    invalidateConversations,
  };
}
