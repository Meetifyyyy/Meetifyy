import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useMessageSend({ activeChatId, currentUser, sendApi }) {
  const queryClient = useQueryClient();

  const handleSend = useCallback(async (payload) => {
    if (!activeChatId || (!payload.text?.trim() && !payload.mediaUrl && !payload.mediaType && !payload.inviteData)) return;

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const optimisticMsg = {
      id: tempId,
      conversationId: activeChatId,
      senderId: currentUser?.id,
      senderName: currentUser?.displayName || currentUser?.username || 'You',
      senderAvatar: currentUser?.avatar || '',
      from: 'me',
      createdAt: now.toISOString(),
      timestamp: now.toISOString(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: payload.mediaUrl || payload.mediaType ? 'media' : 'chat',
      text: payload.text || '',
      mediaUrl: payload.mediaUrl || null,
      mediaType: payload.mediaType || null,
      replyTo: payload.replyTo || null,
      inviteData: payload.inviteData || null,
      status: 'sending',
      state: 'NORMAL'
    };

    queryClient.setQueryData(['messages', activeChatId], (old) => {
      if (!old) return { messages: [optimisticMsg], participants: [] };
      return {
        ...old,
        messages: [...(old.messages || []), optimisticMsg]
      };
    });

    try {
      const serverMsg = await sendApi(activeChatId, payload);
      queryClient.setQueryData(['messages', activeChatId], (old) => {
        if (!old) return { messages: [serverMsg], participants: [] };
        const msgs = (old.messages || []).map(m => m.id === tempId ? serverMsg : m);
        return { ...old, messages: msgs };
      });
      return serverMsg;
    } catch (err) {
      queryClient.setQueryData(['messages', activeChatId], (old) => {
        if (!old) return old;
        const msgs = (old.messages || []).map(m => m.id === tempId ? { ...m, status: 'failed' } : m);
        return { ...old, messages: msgs };
      });
      throw err;
    }
  }, [activeChatId, currentUser, queryClient, sendApi]);

  return { handleSend };
}
