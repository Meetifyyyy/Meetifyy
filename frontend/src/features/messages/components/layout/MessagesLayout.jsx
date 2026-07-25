import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useData } from '@shared/hooks/useData';
import { messagesApi } from '@shared/api/apiClient';
import { useGlobalSocketStore } from '@shared/store/useGlobalSocketStore';
import { parseConversationRoute, generateConversationUrl, correctConversationUrl } from '@shared/utils/conversationUrl';
import ConversationList from '../sidebar/ConversationList';
import ChatArea from '../chat/ChatArea';
import styles from './MessagesLayout.module.css';

export default function MessagesLayout() {
  const { param1, param2 } = useParams();
  const navigate = useNavigate();

  const routeInfo = useMemo(() => parseConversationRoute(param1, param2), [param1, param2]);
  const conversationId = routeInfo.publicId;

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
          return old.map(c => (c.id === conversationId || c.publicId === conversationId) ? { ...c, unread: 0, unreadCount: 0 } : c);
        });
      }
    } else {
      lastMarkedReadIdRef.current = null;
      setActiveChatId(null);
      setShowChatOnMobile(false);
    }
  }, [conversationId, initializeCampusGroupConversation, queryClient]);

  // Fetch message history for active conversation (Initial load: 10 messages)
  const { data: historyData, isLoading: isMessagesLoading, error: messagesError } = useQuery({
    queryKey: ['messages', activeChatId],
    queryFn: () => messagesApi.getHistory(activeChatId, null, null, 10),
    enabled: !!activeChatId,
    staleTime: 5 * 60 * 1000,
  });

  // Listen for realtime incoming messages
  useEffect(() => {
    if (!socket) return;

    const isMatchingConv = (cId, activeId) => {
      if (!cId || !activeId) return false;
      const s1 = String(cId).replace(/^(act_)+/, '');
      const s2 = String(activeId).replace(/^(act_)+/, '');
      if (s1 === s2) return true;
      if (baseConv) {
        const cleanCid = String(baseConv.id).replace(/^(act_)+/, '');
        const cleanPublicId = baseConv.publicId ? String(baseConv.publicId).replace(/^(act_)+/, '') : null;
        const cleanInternalId = baseConv.internalId ? String(baseConv.internalId).replace(/^(act_)+/, '') : null;
        
        // We only want to know if the INCOMING cId (s1) matches the active baseConv
        if (s1 === cleanCid || s1 === cleanPublicId || s1 === cleanInternalId) return true;
      }
      return false;
    };

    const handleNewMessage = (newMsg) => {
      const msgCid = newMsg.publicId || newMsg.conversationId || newMsg.internalId;
      if (isMatchingConv(msgCid, activeChatId)) {
        const isMe = String(newMsg.senderId) === String(currentUser?.id);
        if (!isMe) {
          messagesApi.markAsRead(activeChatId).catch(() => {});
        }

        queryClient.setQueryData(['messages', activeChatId], (old) => {
          if (!old) return { messages: [newMsg], participants: [] };
          const msgs = old.messages || [];

          if (msgs.some(m => m.id === newMsg.id)) return old;

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

    const handleConversationSeen = ({ conversationId: cId, readerId, lastReadAt, isAllRead, minOtherReadAt }) => {
      if (String(readerId) === String(currentUser?.id)) return;
      const targetId = activeChatId;
      if (isMatchingConv(cId, targetId)) {
        queryClient.setQueryData(['messages', targetId], (old) => {
          if (!old || !old.messages) return old;
          const readTimestamp = minOtherReadAt ? new Date(minOtherReadAt).getTime() : new Date(lastReadAt).getTime();
          const updatedMessages = old.messages.map(m => {
            if (m.from === 'me' || String(m.senderId) === String(currentUser?.id)) {
              const mTime = new Date(m.createdAt || m.timestamp).getTime();
              if (isAllRead !== undefined) {
                if (isAllRead && mTime <= readTimestamp) {
                  return { ...m, status: 'read' };
                }
                return { ...m, status: 'sent' };
              }
              if (mTime <= readTimestamp) {
                return { ...m, status: 'read' };
              }
            }
            return m;
          });
          return {
            ...old,
            messages: updatedMessages
          };
        });
      }
    };

    const handleGroupMemberRemoved = ({ conversationId: cId, targetUserId, message }) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['messages', cId] });

      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(c => {
          if (String(c.id) === String(cId)) {
            const isMeRemoved = String(targetUserId) === String(currentUser?.id);
            const updatedMembers = (c.members || c.participants || []).filter(m => {
              const id = typeof m === 'string' ? m : (m.id || m.userId);
              return String(id) !== String(targetUserId);
            });
            return {
              ...c,
              members: updatedMembers,
              participants: updatedMembers,
              ...(isMeRemoved ? { isMember: false } : {}),
              ...(isMeRemoved && c.memberCount ? { memberCount: Math.max(0, c.memberCount - 1) } : {})
            };
          }
          return c;
        });
      });

      if (message) {
        queryClient.setQueryData(['messages', cId], (old) => {
          if (!old || !old.messages) return old;
          if (old.messages.some(m => m.id === message.id)) return old;
          return {
            ...old,
            messages: [...old.messages, message]
          };
        });
      }
    };

    socket.on('message:new', handleNewMessage);
    socket.on('conversation:seen', handleConversationSeen);
    socket.on('group:member_removed', handleGroupMemberRemoved);
    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('conversation:seen', handleConversationSeen);
      socket.off('group:member_removed', handleGroupMemberRemoved);
    };
  }, [socket, activeChatId, currentUser?.id, queryClient]);

  const baseConv = conversations.find((c) => {
    if (!c || activeChatId == null) return false;
    const cleanAid = String(activeChatId).replace(/^(act_)+/, '');
    const cleanCid = String(c.id).replace(/^(act_)+/, '');
    const cleanActId = c.activityId ? String(c.activityId).replace(/^(act_)+/, '') : null;
    return cleanCid === cleanAid || cleanActId === cleanAid;
  }) || (activeChatId ? { id: activeChatId, type: 'DM' } : null);

  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const handleLoadMore = async () => {
    const currentNextCursor = historyData?.nextCursor;
    if (!activeChatId || !currentNextCursor || isFetchingMore) return;

    setIsFetchingMore(true);
    try {
      // Load 15 older messages on each page
      const olderData = await messagesApi.getHistory(activeChatId, null, currentNextCursor, 15);
      if (olderData && olderData.messages) {
        queryClient.setQueryData(['messages', activeChatId], (old) => {
          if (!old) return olderData;
          return {
            ...old,
            messages: [...olderData.messages, ...(old.messages || [])],
            nextCursor: olderData.nextCursor
          };
        });
      }
    } catch {
      // ignore error
    } finally {
      setIsFetchingMore(false);
    }
  };

  const activeConv = useMemo(() => {
    if (!baseConv) return null;
    const msgs = historyData?.messages || baseConv.messages || [];

    return {
      ...baseConv,
      messages: msgs,
      participants: historyData?.participants || baseConv.participants || [],
      nextCursor: historyData?.nextCursor || null
    };
  }, [baseConv, historyData]);

  // Synchronize canonical URL (/inbox/:slug/:publicId) without reloading page or refetching
  useEffect(() => {
    if (!activeChatId || !activeConv) return;

    const targetPath = correctConversationUrl(activeConv, currentUser?.id, window.location.pathname);

    if (window.location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [activeChatId, activeConv, currentUser?.id, navigate]);

  const handleSelectChat = (id, selectedConv) => {
    const targetConv = selectedConv || conversations.find(c => String(c.id) === String(id) || String(c.publicId) === String(id));
    const targetId = targetConv?.publicId || targetConv?.id || id;
    setActiveChatId(targetId);
    setShowChatOnMobile(true);

    const isInbox = window.location.pathname.startsWith('/inbox');
    const basePath = isInbox ? '/inbox' : '/messages';
    const targetPath = generateConversationUrl(targetConv || { id: targetId }, currentUser?.id, basePath);
    navigate(targetPath);
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
          isLoading={isMessagesLoading}
          hasMore={!!activeConv?.nextCursor}
          isLoadingMore={isFetchingMore}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  );
}
