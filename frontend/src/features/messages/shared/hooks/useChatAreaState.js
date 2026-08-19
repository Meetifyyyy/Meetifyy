import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/hooks/useData';
import { useTypingIndicator } from './useTypingIndicator';
import { removeMessageFromCache, updateMessageInCache, updateConversationPreview } from '../utils/cacheUtils';
import { messagesApi } from '@shared/api/apiClient';
import { toast } from 'sonner';
import { useUrlState } from '@shared/hooks/useUrlState';

/**
 * Shared state + handlers for all ChatArea variants (DM, Group).
 * Eliminates duplication across DMChatArea and GroupChatArea.
 */
export function useChatAreaState(conversation) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { users, conversations } = useData();

  const [replyingTo, setReplyingTo] = useState(null);
  const [contextMenuState, setContextMenuState] = useState(null);
  const [unsendConfirmMsg, setUnsendConfirmMsg] = useState(null);
  const [forwardingMsg, setForwardingMsg] = useState(null);
  // The details panel is a full screen of its own on mobile, so it is addressed
  // as ?view=details. That makes Back close the panel and return to the thread
  // instead of closing the thread outright, and keeps the panel open across a
  // reload. Selecting another conversation navigates to a path without the
  // param, so the panel closes on its own — no manual reset needed.
  const [detailsView, setDetailsView] = useUrlState('view', '', {
    allowed: ['details'],
    push: true,
  });
  const showDetails = detailsView === 'details';
  const setShowDetails = useCallback(
    (next) => setDetailsView(next ? 'details' : ''),
    [setDetailsView]
  );
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { typingUsers, isTyping, typingText, handleKeystroke, stopTypingNow } =
    useTypingIndicator(conversation?.id, currentUser?.id);

  // Reset all transient UI state when the conversation changes
  useEffect(() => {
    setContextMenuState(null);
    setReplyingTo(null);
    setUnsendConfirmMsg(null);
    setForwardingMsg(null);
    setShowSearch(false);
    setSearchQuery('');
  }, [conversation?.id]);

  const handleCopyMessage = useCallback((msg) => {
    if (msg?.text) {
      navigator.clipboard.writeText(msg.text);
      toast.success('Copied');
    }
  }, []);

  const handleUnsend = useCallback(async () => {
    if (!unsendConfirmMsg) return;
    const targetMsgId = unsendConfirmMsg.id;
    const convIds = Array.from(
      new Set([conversation?.id, conversation?.publicId, conversation?.internalId].filter(Boolean))
    );
    setUnsendConfirmMsg(null);

    const unsentPatch = {
      state: 'UNSENT',
      isUnsent: true,
      text: 'This message was unsent',
      payload: { text: 'This message was unsent' },
      mediaUrl: null,
      mediaType: null,
      inviteData: null,
      replyTo: null,
    };

    // Instant Optimistic Cache Update (<1ms UX feedback) across all candidate conversation keys
    convIds.forEach((cId) => {
      updateMessageInCache(queryClient, cId, targetMsgId, unsentPatch);
      updateConversationPreview(queryClient, cId, 'This message was unsent');
    });

    try {
      await messagesApi.unsendMessage(targetMsgId);
    } catch {
      toast.error("Couldn't unsend");
      convIds.forEach((cId) => {
        queryClient.invalidateQueries({ queryKey: ['messages', cId] });
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  }, [unsendConfirmMsg, queryClient, conversation]);

  const handleDeleteForMe = useCallback(async (msg) => {
    if (!msg?.id) return;
    const convIds = Array.from(
      new Set([conversation?.id, conversation?.publicId, conversation?.internalId].filter(Boolean))
    );

    // Instant Optimistic Removal (<1ms UX feedback)
    convIds.forEach((cId) => {
      removeMessageFromCache(queryClient, cId, msg.id);
    });

    try {
      await messagesApi.deleteMessageForMe(msg.id);
    } catch {
      toast.error("Couldn't delete message");
      convIds.forEach((cId) => {
        queryClient.invalidateQueries({ queryKey: ['messages', cId] });
      });
    }
  }, [queryClient, conversation]);

  const openContextMenu = useCallback((e, msg) => {
    setContextMenuState({ msg, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenuState(null), []);

  return {
    // Auth / data
    currentUser,
    users,
    conversations,

    // Typing
    typingUsers,
    isTyping,
    typingText,
    handleKeystroke,
    stopTypingNow,

    // UI state
    replyingTo,
    setReplyingTo,
    contextMenuState,
    openContextMenu,
    closeContextMenu,
    unsendConfirmMsg,
    setUnsendConfirmMsg,
    forwardingMsg,
    setForwardingMsg,
    showDetails,
    setShowDetails,
    showSearch,
    setShowSearch,
    searchQuery,
    setSearchQuery,

    // Handlers
    handleCopyMessage,
    handleUnsend,
    handleDeleteForMe,
  };
}
