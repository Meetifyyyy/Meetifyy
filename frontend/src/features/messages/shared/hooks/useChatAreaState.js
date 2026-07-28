import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/hooks/useData';
import { useTypingIndicator } from './useTypingIndicator';
import { removeMessageFromCache } from '../utils/cacheUtils';
import { messagesApi } from '@shared/api/apiClient';
import { toast } from 'sonner';

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
  const [showDetails, setShowDetails] = useState(false);

  const { typingUsers, isTyping, typingText, handleKeystroke, stopTypingNow } =
    useTypingIndicator(conversation?.id, currentUser?.id);

  // Reset all transient UI state when the conversation changes
  useEffect(() => {
    setContextMenuState(null);
    setReplyingTo(null);
    setUnsendConfirmMsg(null);
    setForwardingMsg(null);
    setShowDetails(false);
  }, [conversation?.id]);

  const handleCopyMessage = useCallback((msg) => {
    if (msg?.text) {
      navigator.clipboard.writeText(msg.text);
      toast.success('Copied');
    }
  }, []);

  const handleUnsend = useCallback(async () => {
    if (!unsendConfirmMsg) return;
    try {
      await messagesApi.unsendMessage(unsendConfirmMsg.id);
      // Remove from cache immediately so UI updates without refresh
      removeMessageFromCache(queryClient, conversation?.id, unsendConfirmMsg.id);
    } catch {
      toast.error('Could not unsend');
    } finally {
      setUnsendConfirmMsg(null);
    }
  }, [unsendConfirmMsg, queryClient, conversation?.id]);

  const handleDeleteForMe = useCallback(async (msg) => {
    try {
      await messagesApi.deleteMessageForMe(msg.id);
      // Properly remove from the paged cache structure
      removeMessageFromCache(queryClient, conversation?.id, msg.id);
    } catch {
      toast.error('Could not delete');
    }
  }, [queryClient, conversation?.id]);

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

    // Handlers
    handleCopyMessage,
    handleUnsend,
    handleDeleteForMe,
  };
}
