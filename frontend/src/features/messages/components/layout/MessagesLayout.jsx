import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useData } from '@shared/hooks/useData';
import { messagesApi } from '@shared/api/apiClient';
import { useGlobalSocketStore } from '@shared/store/useGlobalSocketStore';
import ConversationList from '../sidebar/ConversationList';
import ChatArea from '../chat/ChatArea';
import styles from './MessagesLayout.module.css';

export default function MessagesLayout() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { socket } = useGlobalSocketStore();
  const { 
    conversations, 
    isConversationsLoading,
    conversationsError,
    sendDirectMessage, 
    retryDirectMessage,
    reactToMessage, 
    clearChat, 
    toggleBlockUser,
    addGroupMember,
    toggleJoinCampusGroup,
    initializeCampusGroupConversation,
    currentUser
  } = useData();

  const initialChatId = conversationId || null;
  const [activeChatId, setActiveChatId] = useState(initialChatId);
  const [showChatOnMobile, setShowChatOnMobile] = useState(!!conversationId);

  const lastMarkedReadIdRef = useRef(null);

  useEffect(() => {
    if (conversationId) {
      setActiveChatId(conversationId);
      setShowChatOnMobile(true);
      if (String(conversationId).startsWith('c_')) {
        initializeCampusGroupConversation(conversationId);
      }

      if (lastMarkedReadIdRef.current !== conversationId) {
        lastMarkedReadIdRef.current = conversationId;
        messagesApi.markAsRead(conversationId).catch(() => {});
        queryClient.setQueryData(['conversations'], (old) => {
          if (!Array.isArray(old)) return old;
          return old.map(c => c.id === conversationId ? { ...c, unread: 0, unreadCount: 0 } : c);
        });
      }
    } else {
      lastMarkedReadIdRef.current = null;
      setActiveChatId(null);
      setShowChatOnMobile(false);
    }
  }, [conversationId, initializeCampusGroupConversation, queryClient]);

  // Fetch message history for active conversation
  const { data: historyData, isLoading: isMessagesLoading, error: messagesError } = useQuery({
    queryKey: ['messages', activeChatId],
    queryFn: () => messagesApi.getHistory(activeChatId),
    enabled: !!activeChatId,
    staleTime: 10_000,
  });

  // Listen for realtime incoming messages
  useEffect(() => {
    if (!socket || !activeChatId) return;

    const handleNewMessage = (newMsg) => {
      if (newMsg.conversationId === activeChatId) {
        queryClient.setQueryData(['messages', activeChatId], (old) => {
          if (!old) return { messages: [newMsg], participants: [] };
          const msgs = old.messages || [];

          if (msgs.some(m => m.id === newMsg.id)) return old;

          const isMe = String(newMsg.senderId) === String(currentUser?.id);
          const formatted = {
            ...newMsg,
            from: isMe ? 'me' : 'them'
          };

          if (isMe) {
            const tempIdx = msgs.findIndex(m => String(m.id).startsWith('temp_') && (m.text === newMsg.text || m.mediaUrl === newMsg.mediaUrl));
            if (tempIdx !== -1) {
              const updated = [...msgs];
              updated[tempIdx] = formatted;
              return { ...old, messages: updated };
            }
          }

          return {
            ...old,
            messages: [...msgs, formatted]
          };
        });
      }
    };

    socket.on('message:new', handleNewMessage);
    return () => socket.off('message:new', handleNewMessage);
  }, [socket, activeChatId, currentUser?.id, queryClient]);

  const baseConv = conversations.find((c) => {
    if (!c || activeChatId == null) return false;
    const cleanAid = String(activeChatId).replace(/^(act_)+/, '');
    const cleanCid = String(c.id).replace(/^(act_)+/, '');
    const cleanActId = c.activityId ? String(c.activityId).replace(/^(act_)+/, '') : null;
    return cleanCid === cleanAid || cleanActId === cleanAid;
  }) || (activeChatId ? { id: activeChatId, type: 'DM' } : null);

  const activeConv = useMemo(() => {
    if (!baseConv) return null;
    return {
      ...baseConv,
      messages: historyData?.messages || baseConv.messages || [],
      participants: historyData?.participants || baseConv.participants || []
    };
  }, [baseConv, historyData]);

  const handleSelectChat = (id) => {
    setActiveChatId(id);
    setShowChatOnMobile(true);
    navigate(`/messages/${id}`);
  };

  const goBack = useSmartBack();

  const handleBack = () => {
    goBack('/messages', { replace: true });
  };

  const handleSend = async (convId, text, replyTo = null, mentions = [], mediaUrl = null, mediaType = null, explicitLinkPreview = null, explicitInviteData = null) => {
    if (!convId) return;

    const tempId = 'temp_' + Date.now();
    const tempMsg = {
      id: tempId,
      conversationId: convId,
      senderId: currentUser?.id,
      senderName: currentUser?.displayName || currentUser?.username || 'Me',
      senderAvatar: currentUser?.avatar || '',
      from: 'me',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: mediaType === 'audio' ? 'voice' : mediaUrl ? 'media' : 'chat',
      text,
      mediaUrl,
      mediaType,
      mentions,
      replyTo,
      status: 'sending'
    };

    queryClient.setQueryData(['messages', convId], (old) => {
      const msgs = old?.messages || [];
      return {
        ...old,
        messages: [...msgs, tempMsg]
      };
    });

    try {
      const res = await sendDirectMessage(convId, text, replyTo, mentions, mediaUrl, mediaType, explicitLinkPreview, explicitInviteData);
      queryClient.setQueryData(['messages', convId], (old) => {
        const msgs = old?.messages || [];
        const existingIdx = msgs.findIndex(m => m.id === tempId || m.id === res.id);
        if (existingIdx !== -1) {
          const updated = [...msgs];
          updated[existingIdx] = { ...res, from: 'me' };
          return { ...old, messages: updated };
        }
        return old;
      });
    } catch (err) {
      toast.error(err?.message || 'Failed to send message.');
      const isBlockError = err?.message?.toLowerCase().includes('block') || err?.message?.includes('Forbidden');
      queryClient.setQueryData(['messages', convId], (old) => {
        const msgs = old?.messages || [];
        if (isBlockError) {
          return {
            ...old,
            messages: msgs.filter(m => m.id !== tempId)
          };
        }
        return {
          ...old,
          messages: msgs.map(m => m.id === tempId ? { ...m, status: 'failed' } : m)
        };
      });
    }
  };

  const handleReact = (convId, messageIndex, reaction) => {
    reactToMessage(convId, messageIndex, reaction);
  };

  const handleClearChat = (convId) => {
    clearChat(convId);
  };

  const handleBlockUser = (convId) => {
    const targetId = activeConv?.targetUser?.id || activeConv?.userId;
    if (targetId) {
      toggleBlockUser(targetId, activeConv?.blocked);
    }
  };

  const handleJoinGroup = (groupId) => {
    if (String(groupId).startsWith('c_')) {
      toggleJoinCampusGroup(groupId);
    } else {
      addGroupMember(groupId, currentUser?.id);
    }
    handleSelectChat(groupId);
  };

  return (
    <div className={styles.page}>
      <div className={`${styles.messagesLayout}${showChatOnMobile ? ' show-chat' : ''}`}>
        <ConversationList
          conversations={conversations}
          activeChatId={activeChatId}
          onSelect={handleSelectChat}
          showChatOnMobile={showChatOnMobile}
          isLoading={isConversationsLoading}
          error={conversationsError}
        />
        <ChatArea
          conversation={activeConv}
          onSendMessage={handleSend}
          onRetryMessage={(msgId) => retryDirectMessage(activeChatId, msgId)}
          onReactMessage={(msgIndex, reaction) => handleReact(activeChatId, msgIndex, reaction)}
          onClearChat={() => handleClearChat(activeChatId)}
          onBlockUser={() => handleBlockUser(activeChatId)}
          onJoinGroup={handleJoinGroup}
          onBack={handleBack}
          showChatOnMobile={showChatOnMobile}
        />
      </div>
    </div>
  );
}
