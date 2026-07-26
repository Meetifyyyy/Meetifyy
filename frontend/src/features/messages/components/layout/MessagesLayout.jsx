import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/hooks/useData';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { generateConversationUrl, correctConversationUrl } from '@shared/utils/conversationUrl';
import { MessageSquarePlus, Search } from 'lucide-react';
import { messagesApi } from '@shared/api/apiClient';

import DMItem from '../../direct-messages/components/sidebar/DMItem';
import GroupItem from '../../group-chats/components/sidebar/GroupItem';
import ActivityChatItem from '../../activity-chats/components/sidebar/ActivityChatItem';

import DMChatArea from '../../direct-messages/components/chat/DMChatArea';
import GroupChatArea from '../../group-chats/components/chat/GroupChatArea';
import ActivityChatArea from '../../activity-chats/components/chat/ActivityChatArea';

import DMContextMenu from '../../direct-messages/components/sidebar/DMContextMenu';
import GroupContextMenu from '../../group-chats/components/sidebar/GroupContextMenu';
import ActivityChatContextMenu from '../../activity-chats/components/sidebar/ActivityChatContextMenu';

import NewMessageModal from '../../shared/components/modals/NewMessageModal';
import ConversationSkeleton from '../../shared/components/skeletons/ConversationSkeleton';

import styles from './MessagesLayout.module.css';
import sidebarStyles from '../../shared/components/sidebar/ConversationList.module.css';

export default function MessagesLayout() {
  const { param1, param2 } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const goBack = useSmartBack();

  const {
    conversations = [],
    isConversationsLoading,
    conversationsError,
    sendDirectMessage,
    reactToMessage,
    clearChat,
    toggleBlockUser,
    leaveGroup,
    endCrewActivity,
    startConversation,
    createGroupConversation,
    togglePinConversation,
    toggleMuteConversation,
    deleteConversation,
    socket,
  } = useData();

  const routeChatId = param2 || param1 || null;
  const [activeChatId, setActiveChatId] = useState(routeChatId);
  const [showChatOnMobile, setShowChatOnMobile] = useState(!!routeChatId);

  const [activeFilter, setActiveFilter] = useState('All');
  const [searchVal, setSearchVal] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    if (routeChatId) {
      setActiveChatId(routeChatId);
      setShowChatOnMobile(true);
    } else {
      setActiveChatId(null);
      setShowChatOnMobile(false);
    }
  }, [routeChatId]);

  // Realtime socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (payload) => {
      const message = payload?.message || payload;
      const conversationId = payload?.conversationId || message?.conversationId;
      if (!message || !conversationId) return;

      queryClient.setQueryData(['messages', conversationId], (old) => {
        if (!old || !old.pages || old.pages.length === 0) return old;
        const newPages = [...old.pages];
        const firstPage = newPages[0] || { messages: [] };
        const existingMsgs = firstPage.messages || [];

        const exists = existingMsgs.some(m => m.id === message.id || (m.tempId && m.tempId === message.tempId));
        if (exists) {
          const updatedMsgs = existingMsgs.map(m => (m.id === message.id || (m.tempId && m.tempId === message.tempId)) ? message : m);
          newPages[0] = { ...firstPage, messages: updatedMsgs };
        } else {
          newPages[0] = { ...firstPage, messages: [...existingMsgs, message] };
        }
        return { ...old, pages: newPages };
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const handleUpdateMessage = (updatedMsg) => {
      if (!updatedMsg || !updatedMsg.id) return;
      
      const convId = updatedMsg.publicId || updatedMsg.conversationId || updatedMsg.internalId;
      if (!convId) return;

      queryClient.setQueryData(['messages', convId], (old) => {
        if (!old || !old.pages) return old;
        const newPages = old.pages.map(page => ({
          ...page,
          messages: (page.messages || []).map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m)
        }));
        return { ...old, pages: newPages };
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    socket.on('message:new', handleNewMessage);
    socket.on('message:updated', handleUpdateMessage);
    
    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:updated', handleUpdateMessage);
    };
  }, [socket, queryClient]);

  // Fetch messages history whenever activeChatId changes using infinite query
  const {
    data: historyPages,
    isLoading: isMessagesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['messages', activeChatId],
    queryFn: ({ pageParam }) => activeChatId ? messagesApi.getHistory(activeChatId, undefined, pageParam) : null,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    enabled: !!activeChatId,
    staleTime: 1000 * 30,
  });

  // Flatten and deduplicate all loaded pages of messages (oldest to newest)
  const allMessages = useMemo(() => {
    if (!historyPages?.pages) return [];
    // Reverse pages array so older pages come first, then flatMap messages
    const reversedPages = [...historyPages.pages].reverse();
    const flat = reversedPages.flatMap(page => page?.messages || []);
    
    const seen = new Set();
    return flat.filter(m => {
      if (!m) return false;
      const key = m.id || m.tempId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [historyPages?.pages]);

  // Find active conversation and merge history messages
  const baseConv = useMemo(() => {
    if (!activeChatId) return null;
    const cleanAid = String(activeChatId).replace(/^(act_)+/, '');
    return conversations.find((c) => {
      const cleanCid = String(c.id).replace(/^(act_)+/, '');
      const cleanActId = c.activityId ? String(c.activityId).replace(/^(act_)+/, '') : null;
      return String(c.id) === String(activeChatId) || String(c.publicId) === String(activeChatId) || cleanCid === cleanAid || cleanActId === cleanAid;
    }) || { id: activeChatId };
  }, [conversations, activeChatId]);

  const activeConv = useMemo(() => {
    if (!baseConv) return null;
    const latestPage = historyPages?.pages?.[0];
    return {
      ...baseConv,
      messages: allMessages.length > 0 ? allMessages : (baseConv.messages || []),
      participants: latestPage?.participants || baseConv.participants || baseConv.members || [],
      nextCursor: latestPage?.nextCursor || null,
    };
  }, [baseConv, allMessages, historyPages?.pages]);

  // URL sync
  useEffect(() => {
    if (!activeChatId || !activeConv) return;
    const targetPath = correctConversationUrl(activeConv, currentUser?.id, location.pathname);
    if (location.pathname !== targetPath && targetPath !== location.pathname) {
      navigate(targetPath, { replace: true });
    }
  }, [activeChatId, activeConv, currentUser?.id, location.pathname, navigate]);

  // Mark as read when opening a conversation
  useEffect(() => {
    if (activeConv && activeConv.unread > 0 && document.visibilityState === 'visible') {
      messagesApi.markAsRead(activeConv.id).then(() => {
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }).catch(() => {});
    }
  }, [activeConv?.id, activeConv?.unread, queryClient]);

  const totalUnread = useMemo(() => {
    return (conversations || []).reduce((sum, c) => sum + (c.unread || 0), 0);
  }, [conversations]);

  const filteredConvs = useMemo(() => {
    return (conversations || [])
      .filter(c => {
        if (activeFilter === 'Unread') return (c.unread || 0) > 0;
        if (activeFilter === 'DMs') return !c.isGroup && !c.isActivityChat && !String(c.id).startsWith('act_') && !String(c.id).startsWith('c_');
        if (activeFilter === 'Groups') return c.isGroup || c.isActivityChat || String(c.id).startsWith('act_') || String(c.id).startsWith('c_');
        return true;
      })
      .filter(c => {
        if (!searchVal.trim()) return true;
        const term = searchVal.toLowerCase();
        return (c.name || '').toLowerCase().includes(term) || (c.lastMsg || c.lastMessageText || '').toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
      });
  }, [conversations, activeFilter, searchVal]);

  const handleSelectChat = (id, selectedConv) => {
    const targetConv = selectedConv || conversations.find(c => String(c.id) === String(id) || String(c.publicId) === String(id));
    const targetId = targetConv?.publicId || targetConv?.id || id;
    setActiveChatId(targetId);
    setShowChatOnMobile(true);

    const basePath = location.pathname.startsWith('/inbox') ? '/inbox' : '/messages';
    const targetPath = generateConversationUrl(targetConv || { id: targetId }, currentUser?.id, basePath);
    navigate(targetPath);
  };

  const handleBack = () => {
    setShowChatOnMobile(false);
    setActiveChatId(null);
    const basePath = location.pathname.startsWith('/inbox') ? '/inbox' : '/messages';
    navigate(basePath, { replace: true });
  };

  const handleContextMenu = (e, convId) => {
    e.preventDefault();
    const conv = conversations.find(c => String(c.id) === String(convId));
    if (!conv) return;
    setContextMenu({ conv, x: e.clientX, y: e.clientY });
  };

  const handleStartChat = async (targetUser) => {
    const newConvId = await startConversation(targetUser);
    setIsModalOpen(false);
    if (newConvId) handleSelectChat(newConvId);
  };

  const handleCreateGroup = async (groupName, userIds) => {
    const newConvId = await createGroupConversation(groupName, userIds);
    setIsModalOpen(false);
    if (newConvId) handleSelectChat(newConvId);
  };

  // Helper to determine component type for a conversation
  const getConvType = (c) => {
    if (c.isActivityChat || String(c.id).startsWith('act_') || c.activityId) return 'activity';
    if (c.isGroup || String(c.id).startsWith('c_') || c.isCampusGroup) return 'group';
    return 'dm';
  };

  return (
    <div className={styles.page}>
      <div className={`${styles.messagesLayout}${showChatOnMobile ? ` ${styles.showChat}` : ''}`}>
        
        {/* SIDEBAR */}
        <div className={`${sidebarStyles.msgConvList}${showChatOnMobile ? ` ${sidebarStyles.hideOnMobile}` : ''}`}>
          <div className={sidebarStyles.headerWrapper}>
            <div className={sidebarStyles.msgConvHeader}>
              <div className={sidebarStyles.titleGroup}>
                <h2 className={sidebarStyles.msgConvTitle}>Messages</h2>
              </div>
            </div>

            <div className={sidebarStyles.searchRow}>
              <div className={sidebarStyles.msgConvSearch}>
                <Search size={16} className={sidebarStyles.searchIcon} />
                <input 
                  type="text" 
                  className={sidebarStyles.msgSearchInput} 
                  placeholder="Search conversations..." 
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                />
              </div>
              <button 
                className={sidebarStyles.msgNewBtn} 
                title="New Message" 
                onClick={() => setIsModalOpen(true)}
                aria-label="New Message"
              >
                <MessageSquarePlus size={20} />
              </button>
            </div>

            <div className={sidebarStyles.filterRow}>
              {['All', 'Unread', 'DMs', 'Groups'].map(filter => {
                const showCount = filter === 'Unread' && totalUnread > 0;
                return (
                  <button 
                    key={filter} 
                    className={`${sidebarStyles.filterChip} ${activeFilter === filter ? sidebarStyles.activeFilter : ''}`} 
                    onClick={() => setActiveFilter(filter)}
                  >
                    {filter}{showCount ? ` (${totalUnread > 99 ? '99+' : totalUnread})` : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={sidebarStyles.msgConvScroll}>
            {isConversationsLoading ? (
              <>
                <ConversationSkeleton />
                <ConversationSkeleton />
                <ConversationSkeleton />
              </>
            ) : filteredConvs.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <p style={{ fontSize: '0.9rem', margin: 0 }}>{searchVal ? 'No conversations match your search' : 'No conversations yet'}</p>
              </div>
            ) : (
              filteredConvs.map((conv) => {
                const type = getConvType(conv);
                if (type === 'activity') {
                  return (
                    <ActivityChatItem
                      key={conv.id}
                      conv={conv}
                      activeChatId={activeChatId}
                      onSelect={handleSelectChat}
                      onContextMenu={handleContextMenu}
                    />
                  );
                }
                if (type === 'group') {
                  return (
                    <GroupItem
                      key={conv.id}
                      conv={conv}
                      activeChatId={activeChatId}
                      onSelect={handleSelectChat}
                      onContextMenu={handleContextMenu}
                    />
                  );
                }
                return (
                  <DMItem
                    key={conv.id}
                    conv={conv}
                    activeChatId={activeChatId}
                    onSelect={handleSelectChat}
                    onContextMenu={handleContextMenu}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* CHAT AREA */}
        {(() => {
          const type = activeConv ? getConvType(activeConv) : 'dm';
          const paginationProps = {
            hasMore: !!hasNextPage,
            isLoadingMore: isFetchingNextPage,
            onLoadMore: () => {
              if (hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }
          };

          if (type === 'activity') {
            return (
              <ActivityChatArea
                conversation={activeConv}
                onSendMessage={sendDirectMessage}
                onReactMessage={reactToMessage}
                onEndActivity={endCrewActivity}
                onBack={handleBack}
                showChatOnMobile={showChatOnMobile}
                isLoading={isConversationsLoading || (isMessagesLoading && allMessages.length === 0)}
                {...paginationProps}
              />
            );
          }
          if (type === 'group') {
            return (
              <GroupChatArea
                conversation={activeConv}
                onSendMessage={sendDirectMessage}
                onReactMessage={reactToMessage}
                onLeaveGroup={leaveGroup}
                onBack={handleBack}
                showChatOnMobile={showChatOnMobile}
                isLoading={isConversationsLoading || (isMessagesLoading && allMessages.length === 0)}
                {...paginationProps}
              />
            );
          }
          return (
            <DMChatArea
              conversation={activeConv}
              onSendMessage={sendDirectMessage}
              onReactMessage={reactToMessage}
              onClearChat={clearChat}
              onBlockUser={toggleBlockUser}
              onBack={handleBack}
              showChatOnMobile={showChatOnMobile}
              isLoading={isConversationsLoading || (isMessagesLoading && allMessages.length === 0)}
              {...paginationProps}
            />
          );
        })()}

      </div>

      {/* CONTEXT MENUS & MODALS */}
      {contextMenu && (() => {
        const type = getConvType(contextMenu.conv);
        if (type === 'activity') {
          return (
            <ActivityChatContextMenu
              conv={contextMenu.conv}
              position={{ x: contextMenu.x, y: contextMenu.y }}
              onClose={() => setContextMenu(null)}
              onMarkRead={() => messagesApi.markAsRead(contextMenu.conv.id)}
              onMute={() => toggleMuteConversation(contextMenu.conv.id)}
              onPin={() => togglePinConversation(contextMenu.conv.id)}
            />
          );
        }
        if (type === 'group') {
          return (
            <GroupContextMenu
              conv={contextMenu.conv}
              position={{ x: contextMenu.x, y: contextMenu.y }}
              onClose={() => setContextMenu(null)}
              onMarkRead={() => messagesApi.markAsRead(contextMenu.conv.id)}
              onMute={() => toggleMuteConversation(contextMenu.conv.id)}
              onPin={() => togglePinConversation(contextMenu.conv.id)}
              onLeave={() => leaveGroup(contextMenu.conv.id)}
            />
          );
        }
        return (
          <DMContextMenu
            conv={contextMenu.conv}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu(null)}
            onMarkRead={() => messagesApi.markAsRead(contextMenu.conv.id)}
            onMute={() => toggleMuteConversation(contextMenu.conv.id)}
            onPin={() => togglePinConversation(contextMenu.conv.id)}
            onDelete={() => deleteConversation(contextMenu.conv.id)}
          />
        );
      })()}

      {isModalOpen && (
        <NewMessageModal
          onClose={() => setIsModalOpen(false)}
          onStartChat={handleStartChat}
          onCreateGroup={handleCreateGroup}
        />
      )}
    </div>
  );
}
