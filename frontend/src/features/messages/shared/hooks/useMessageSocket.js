import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalSocketStore } from '@shared/store/useGlobalSocketStore';

export function useMessageSocket({ activeChatId, currentUser, baseConv, markAsReadApi }) {
  const queryClient = useQueryClient();
  const { socket } = useGlobalSocketStore();
  const baseConvRef = useRef(baseConv);

  useEffect(() => {
    baseConvRef.current = baseConv;
  }, [baseConv]);

  useEffect(() => {
    if (!socket) return;

    const isMatchingConv = (cId, activeId) => {
      if (!cId || !activeId) return false;
      const s1 = String(cId).replace(/^act_/, '');
      const s2 = String(activeId).replace(/^act_/, '');
      if (s1 === s2) return true;
      const currentBase = baseConvRef.current;
      if (currentBase) {
        const cleanCid = String(currentBase.id).replace(/^act_/, '');
        const cleanPublicId = currentBase.publicId ? String(currentBase.publicId).replace(/^act_/, '') : null;
        const cleanInternalId = currentBase.internalId ? String(currentBase.internalId).replace(/^act_/, '') : null;
        if (s1 === cleanCid || s1 === cleanPublicId || s1 === cleanInternalId) return true;
      }
      return false;
    };

    const handleNewMessage = (newMsg) => {
      const msgCid = newMsg.publicId || newMsg.conversationId || newMsg.internalId;
      if (isMatchingConv(msgCid, activeChatId)) {
        const isMe = String(newMsg.senderId) === String(currentUser?.id);
        if (!isMe && markAsReadApi) {
          markAsReadApi(activeChatId).catch(() => {});
        }

        queryClient.setQueryData(['messages', activeChatId], (old) => {
          if (!old) return { messages: [newMsg], participants: [] };
          const msgs = old.messages || [];
          if (msgs.some(m => m.id === newMsg.id)) return old;

          const formatted = {
            ...newMsg,
            from: isMe ? 'me' : 'them',
            status: isMe ? 'sent' : 'read'
          };
          return {
            ...old,
            messages: [...msgs, formatted]
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const handleConversationSeen = (data) => {
      const { conversationId: seenCid, readerId } = data;
      if (isMatchingConv(seenCid, activeChatId) && String(readerId) !== String(currentUser?.id)) {
        queryClient.setQueryData(['messages', activeChatId], (old) => {
          if (!old) return old;
          const msgs = (old.messages || []).map(m => {
            if (m.from === 'me') {
              return { ...m, status: 'read' };
            }
            return m;
          });
          return { ...old, messages: msgs };
        });
      }
    };

    const handleMessageUpdated = (msgData) => {
      const msgCid = msgData.publicId || msgData.conversationId || msgData.internalId;
      if (isMatchingConv(msgCid, activeChatId)) {
        queryClient.setQueryData(['messages', activeChatId], (old) => {
          if (!old) return old;
          const msgs = (old.messages || []).map(m => m.id === msgData.id ? { ...m, ...msgData } : m);
          return { ...old, messages: msgs };
        });
      }
    };

    socket.on('message:new', handleNewMessage);
    socket.on('conversation:seen', handleConversationSeen);
    socket.on('message:updated', handleMessageUpdated);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('conversation:seen', handleConversationSeen);
      socket.off('message:updated', handleMessageUpdated);
    };
  }, [socket, activeChatId, currentUser?.id, queryClient, markAsReadApi]);
}
