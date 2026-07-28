import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/hooks/useData';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useChatManager } from '../../shared/hooks/useChatManager';
import { generateConversationUrl, correctConversationUrl } from '@shared/utils/conversationUrl';
import { MessageSquarePlus, Search } from 'lucide-react';

import DMItem from '../../direct-messages/components/sidebar/DMItem';
import GroupItem from '../../group-chats/components/sidebar/GroupItem';

import DMChatArea from '../../direct-messages/components/chat/DMChatArea';
import GroupChatArea from '../../group-chats/components/chat/GroupChatArea';

import DMContextMenu from '../../direct-messages/components/sidebar/DMContextMenu';
import GroupContextMenu from '../../group-chats/components/sidebar/GroupContextMenu';

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
    endGroup,
    startConversation,
    createGroupConversation,
    togglePinConversation,
    toggleMuteConversation,
    deleteConversation,
  } = useData();

  const routeChatId = param2 || param1 || null;
  const [activeChatId, setActiveChatId] = useState(routeChatId);
  const [showChatOnMobile, setShowChatOnMobile] = useState(!!routeChatId);

  const handleBack = () => {
    setShowChatOnMobile(false);
    setActiveChatId(null);
    const fallbackPath = location.pathname.startsWith('/inbox') ? '/inbox' : '/messages';
    if (location.state?.from) {
      navigate(location.state.from, { replace: true });
    } else {
      goBack(fallbackPath);
    }
  };

  const handleSelectChat = (id, selectedConv) => {
    const targetConv = selectedConv || conversations.find(c => String(c.id) === String(id) || String(c.publicId) === String(id));
    const targetId = targetConv?.publicId || targetConv?.id || id;
    setActiveChatId(targetId);
    setShowChatOnMobile(true);

    const basePath = location.pathname.startsWith('/inbox') ? '/inbox' : '/messages';
    const targetPath = generateConversationUrl(targetConv || { id: targetId }, currentUser?.id, basePath);
    navigate(targetPath);
  };

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

  const { 
    messages: allMessages,
    rawPages,
    isLoading: isMessagesLoading, 
    hasMore: hasNextPage, 
    isLoadingMore: isFetchingNextPage, 
    onLoadMore: fetchNextPage,
    sendMessageOptimistically,
    markSeenIfEligible
  } = useChatManager(activeChatId, 'messages', currentUser);

  // Find active conversation and merge history messages
  const baseConv = useMemo(() => {
    if (!activeChatId) return null;
    const targetStr = String(activeChatId);
    const cleanAid = targetStr.replace(/^(act_)+/, '');
    return conversations.find((c) => {
      if (!c) return false;
      const idStr = c.id != null ? String(c.id) : null;
      const pubIdStr = c.publicId != null ? String(c.publicId) : null;
      const actIdStr = c.activityId != null ? String(c.activityId) : null;
      const cleanCid = idStr ? idStr.replace(/^(act_)+/, '') : null;
      const cleanActId = actIdStr ? actIdStr.replace(/^(act_)+/, '') : null;

      return (
        (idStr && idStr === targetStr) ||
        (pubIdStr && pubIdStr === targetStr) ||
        (cleanCid && cleanCid === cleanAid) ||
        (cleanActId && cleanActId === cleanAid)
      );
    }) || { id: activeChatId };
  }, [conversations, activeChatId]);

  const activeConv = useMemo(() => {
    if (!baseConv) return null;
    const latestPage = rawPages?.[rawPages.length - 1];
    return {
      ...baseConv,
      messages: allMessages,
      participants: latestPage?.participants || baseConv.participants || baseConv.members || [],
      nextCursor: latestPage?.nextCursor || null,
    };
  }, [baseConv, allMessages, rawPages]);

  // URL sync
  useEffect(() => {
    if (!activeChatId || !activeConv) return;
    const targetPath = correctConversationUrl(activeConv, currentUser?.id, location.pathname);
    if (location.pathname !== targetPath && targetPath !== location.pathname) {
      navigate(targetPath, { replace: true, state: location.state });
    }
  }, [activeChatId, activeConv, currentUser?.id, location.pathname, navigate]);

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
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });
  }, [conversations, activeFilter, searchVal]);

  const handleContextMenu = (e, convId) => {
    e.preventDefault();
    const conv = conversations.find(c => String(c.id) === String(convId));
    if (!conv) return;
    setContextMenu({ conv, x: e.clientX, y: e.clientY });
  };

  const handleStartChat = (targetUser) => {
    const newConvId = startConversation(targetUser);
    setIsModalOpen(false);
    if (newConvId) handleSelectChat(newConvId);
  };

  const handleCreateGroup = (groupName, userIds) => {
    const newConvId = createGroupConversation(groupName, userIds);
    setIsModalOpen(false);
    if (newConvId) handleSelectChat(newConvId);
  };

  // Activity group chats are rendered as normal group chats
  const getConvType = (c) => {
    if (c.isGroup || c.isActivityChat || String(c.id).startsWith('act_') || String(c.id).startsWith('c_') || c.isCampusGroup || c.activityId) return 'group';
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
            },
            onMarkSeen: markSeenIfEligible,
          };

          const activeKey = activeChatId || activeConv?.id || 'chat';

          if (type === 'group') {
            return (
              <GroupChatArea
                key={activeKey}
                conversation={activeConv}
                onSendMessage={sendMessageOptimistically}
                onReactMessage={reactToMessage}
                onLeaveGroup={leaveGroup}
                onEndGroup={endGroup}
                onClearChat={clearChat}
                onTogglePin={togglePinConversation}
                onBack={handleBack}
                showChatOnMobile={showChatOnMobile}
                isLoading={isConversationsLoading || (isMessagesLoading && allMessages.length === 0)}
                {...paginationProps}
              />
            );
          }
          return (
            <DMChatArea
              key={activeKey}
              conversation={activeConv}
              onSendMessage={sendMessageOptimistically}
              onReactMessage={reactToMessage}
              onClearChat={clearChat}
              onTogglePin={togglePinConversation}
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
        if (type === 'group') {
          return (
            <GroupContextMenu
              conv={contextMenu.conv}
              position={{ x: contextMenu.x, y: contextMenu.y }}
              onClose={() => setContextMenu(null)}
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
