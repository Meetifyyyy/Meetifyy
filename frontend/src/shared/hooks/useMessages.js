/**
 * useMessages — the conversation list query, and the query keys for it.
 *
 * Conversation *mutations* live in useMessageActions / useGroupActions. This
 * module used to export a second, parallel set of them (useMessageMutations)
 * that nothing imported: two implementations of delete, mute, pin, clear,
 * block and leave, free to drift apart, with no way to tell from a call site
 * which one was authoritative. It has been removed.
 *
 * NOT persisted to IndexedDB (active chat state should never be stale across sessions).
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { messagesApi } from '@shared/api/apiClient';
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
// Stable identity for the "no data yet" case. A literal `= []` default builds a
// fresh array on every render, which busts both the memo below and the shared
// cache, so the map+sort re-ran constantly while the query was still loading.
const EMPTY_CONVERSATIONS = [];

let _convCacheRaw;
let _convCacheUserId;
let _convCacheResult = [];

export function useConversations() {
  const { currentUser, isLoggedIn } = useAuth();

  const { data: rawConversations = EMPTY_CONVERSATIONS, isLoading, error } = useQuery({
    queryKey: MESSAGE_KEYS.conversations,
    queryFn: () => messagesApi.getConversations(50, 0),
    enabled: Boolean(isLoggedIn || currentUser?.id),
    staleTime: 60 * 1000,   // 60s
    gcTime:    5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Shared across callers: the processed list is a pure function of
  // (rawConversations, currentUser.id), but useConversations is now called from
  // a dozen places -- several of them nested -- so a per-component useMemo ran
  // this map+sort once per caller on every render pass. The module-level cache
  // below means the first caller for a given input computes and everyone else
  // gets the identical array back by reference, which also stops downstream
  // memo boundaries from seeing a "new" array each time.
  const conversations = useMemo(() => {
    if (_convCacheRaw === rawConversations && _convCacheUserId === currentUser?.id) {
      return _convCacheResult;
    }
    const list = (rawConversations || []).map((c) => {
      const pList = c.participants || c.members || [];
      const calculatedIsMember = (!c.type || c.type === 'DIRECT')
        ? true
        : pList.some((p) => {
            const id = typeof p === 'string' ? p : (p.id || p.userId);
            return String(id) === String(currentUser?.id);
          });
      const isMember = c.isMember !== undefined ? c.isMember : calculatedIsMember;
      const isGroup = c.type === 'GROUP' || !!c.isGroup;

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

    const sorted = [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    _convCacheRaw = rawConversations;
    _convCacheUserId = currentUser?.id;
    _convCacheResult = sorted;
    return sorted;
  }, [rawConversations, currentUser?.id]);

  return {
    conversations,
    rawConversations,
    isLoading,
    error,
  };
}
