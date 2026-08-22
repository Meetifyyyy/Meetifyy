import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { useConversations } from '@shared/hooks/useMessages';
import { useMessageActions } from '@shared/hooks/useMessageActions';
import { useGroupActions } from '@shared/hooks/useGroupActions';
import { useChatManager } from '../../shared/hooks/useChatManager';
import { matchesConversationId } from '../../shared/utils/cacheUtils';
import { generateConversationUrl, correctConversationUrl, parseConversationRoute } from '@shared/utils/conversationUrl';
import { showToast } from '@shared/utils/toast';
import { useSmartBack } from '@shared/hooks/useSmartBack';
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

// One canonical prefix for every conversation URL. /inbox/* still resolves —
// the router redirects it here — so old links keep working without the module
// having to carry two parallel URL shapes around.
const MESSAGES_BASE = '/messages';

export default function MessagesLayout() {
  const { param1, param2 } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();

  // `conversationsError`, `sendDirectMessage` and `startConversation` were
  // destructured here but never referenced -- dropped rather than migrated.
  const { conversations = [], isLoading: isConversationsLoading } = useConversations();
  const {
    reactToMessage, clearChat, toggleBlockUser, createGroupConversation,
    toggleMuteConversation, deleteConversation,
  } = useMessageActions();
  const { leaveGroup, endGroup, togglePinConversation } = useGroupActions();

  // parseConversationRoute understands both the canonical /messages/:slug/:publicId
  // format and legacy 2-segment links where the id comes first — a naive
  // `param2 || param1` misreads legacy links (id, slug) as (slug, id) and ends up
  // treating the slug string as the conversation id, which can never match.
  const { publicId: routeChatId } = parseConversationRoute(param1, param2);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const draftUserId = searchParams.get('user') || location.state?.targetUser?.id;
  const isDraftRoute = routeChatId === 'new' || (routeChatId && String(routeChatId).startsWith('draft_'));

  // The URL owns which conversation is open. Nothing mirrors it in component
  // state: a mirrored copy is what made reloads and Back drop out of the chat,
  // because the copy and the URL could disagree about what was on screen.
  const activeChatId = isDraftRoute
    ? (draftUserId ? `draft_${draftUserId}` : 'new')
    : (routeChatId || null);
  // Deleting the conversation that is currently open has to close it too: the
  // route still names a conversation that no longer exists for this user, and
  // leaving it mounted would refetch a 404 (or worse, keep rendering the
  // history from cache). Navigating first means the thread unmounts before the
  // purge lands, so nothing re-reads the caches on their way out.
  const handleDeleteConversation = useCallback((conv) => {
    if (!conv) return;
    if (activeChatId && matchesConversationId(conv, activeChatId)) {
      navigate('/messages', { replace: true });
    }
    deleteConversation(conv.id);
  }, [activeChatId, navigate, deleteConversation]);

  // Mobile shows the list and the thread as two screens of one stack; which one
  // is visible is purely a function of whether the URL names a conversation.
  const showChatOnMobile = !!activeChatId;

  const handleBack = () => {
    // Closing a thread is a real back step, so pop the history entry that
    // opening it pushed. goBack falls back to the conversation list when there
    // is nothing behind us (deep link, refresh, new tab).
    goBack(MESSAGES_BASE);
  };

  const handleSelectChat = (id, selectedConv) => {
    const targetConv = selectedConv || conversations.find(c => String(c.id) === String(id) || String(c.publicId) === String(id));
    const targetId = targetConv?.publicId || targetConv?.id || id;

    const targetPath = generateConversationUrl(targetConv || { id: targetId }, currentUser?.id, MESSAGES_BASE);
    if (targetPath === location.pathname) return;

    // PUSH, not replace. Opening a conversation is a navigation the user can
    // back out of; replacing here is what made browser Back leave Messages
    // entirely instead of returning to the conversation list.
    navigate(targetPath, { state: location.state });
  };

  const [activeFilter, setActiveFilter] = useState('All');
  const [searchVal, setSearchVal] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  const {
    messages: allMessages,
    rawPages,
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    onLoadMore: fetchNextPage,
    sendMessageOptimistically,
    retryUpload,
    cancelUpload,
    markSeenIfEligible
  } = useChatManager(activeChatId, 'messages', currentUser);

  const isKnownConversation = useMemo(() => {
    if (!activeChatId || isDraftRoute) return true;
    return conversations.some((c) => matchesConversationId(c, activeChatId));
  }, [conversations, activeChatId, isDraftRoute]);

  // useChatManager never fetches history for ids carrying the temp_/c_temp_
  // prefixes reserved for not-yet-synced local records — matches its `enabled`
  // guard. Those ids can never resolve, so there's no fetch to wait on.
  const canFetchMessages = !!activeChatId && !String(activeChatId).startsWith('temp_') && !String(activeChatId).startsWith('c_temp_');

  // True once we can say with certainty that the id in the URL is not a real,
  // accessible conversation: the sidebar's own conversation list has finished
  // loading and doesn't contain it, AND either the backend has authoritatively
  // rejected it (404/403, collapsed into the same error by design) or the id
  // is shaped such that it was never going to be fetched at all.
  const isChatInvalid = (
    !!activeChatId &&
    !isDraftRoute &&
    !isKnownConversation &&
    !isConversationsLoading &&
    (canFetchMessages ? (!isMessagesLoading && isMessagesError) : true)
  );

  // Find active conversation and merge history messages
  const baseConv = useMemo(() => {
    if (!activeChatId) return null;
    const found = conversations.find((c) => matchesConversationId(c, activeChatId));
    if (found) return found;

    if (String(activeChatId).startsWith('draft_') || isDraftRoute || draftUserId) {
      const targetId = draftUserId || (String(activeChatId).startsWith('draft_') ? activeChatId.replace('draft_', '') : null);
      const targetUser = location.state?.targetUser || null;
      return {
        id: activeChatId,
        publicId: activeChatId,
        type: 'DM',
        isDraft: true,
        targetUserId: targetId,
        targetUser,
        name: targetUser?.displayName || targetUser?.username || 'New Message',
        avatar: targetUser?.avatar || null,
        participants: targetUser ? [{ userId: currentUser?.id, user: currentUser }, { userId: targetUser.id, user: targetUser }] : [],
      };
    }

    return { id: activeChatId };
  }, [conversations, activeChatId, isDraftRoute, draftUserId, location.state?.targetUser, currentUser]);

  const activeConv = useMemo(() => {
    if (!baseConv) return null;
    const initialPage = rawPages?.[0];
    const latestPage = rawPages?.[rawPages.length - 1];

    const isGroupConv = baseConv.type === 'GROUP' || !!baseConv.isGroup;

    const otherMsg = (allMessages || []).find(m => m.from === 'them' || (m.senderId && String(m.senderId) !== String(currentUser?.id)));
    const inferredName = baseConv.name || initialPage?.name || otherMsg?.senderName || 'Chat';

    const inferredAvatar = isGroupConv
      ? (baseConv.avatarKey || baseConv.avatar || null)
      : (baseConv.avatar || initialPage?.avatar || otherMsg?.senderAvatar || null);

    return {
      ...baseConv,
      name: inferredName,
      avatar: inferredAvatar,
      messages: allMessages,
      participants: initialPage?.participants || baseConv.participants || baseConv.members || [],
      nextCursor: latestPage?.nextCursor || null,
    };
  }, [baseConv, allMessages, rawPages, currentUser?.id]);

  // URL sync
  useEffect(() => {
    if (!activeChatId || !activeConv || activeConv.isDraft) return;
    const targetPath = correctConversationUrl(activeConv, currentUser?.id, MESSAGES_BASE);
    if (location.pathname !== targetPath && targetPath !== location.pathname) {
      navigate(targetPath, { replace: true, state: location.state });
    }
  }, [activeChatId, activeConv, currentUser?.id, location.pathname, navigate]);

  const handleSendMessage = async (convId, text, replyTo, mentions, mediaUrl, mediaType, explicitLinkPreview, explicitInviteData, options) => {
    if (activeConv?.isDraft) {
      const targetId = activeConv.targetUserId || activeConv.targetUser?.id;
      if (targetId) {
        try {
          const { dmApi } = await import('@shared/api/apiClient');
          const res = await dmApi.startDM(targetId);
          const realId = res?.publicId || res?.id;
          if (realId) {
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            // REPLACE: the draft URL was never a place worth returning to, so
            // the real conversation takes its slot in the stack rather than
            // adding one Back press that lands on an empty draft.
            navigate(`${MESSAGES_BASE}/${realId}`, { replace: true, state: location.state });
            await sendMessageOptimistically(realId, text, replyTo, mentions, mediaUrl, mediaType, explicitLinkPreview, explicitInviteData, options);
            return;
          }
        } catch (err) {
          console.error('Failed to create conversation on send:', err);
          showToast('Message failed to send', 'error');
          return;
        }
      }
    }
    return sendMessageOptimistically(convId, text, replyTo, mentions, mediaUrl, mediaType, explicitLinkPreview, explicitInviteData, options);
  };

  const totalUnread = useMemo(() => {
    return (conversations || []).reduce((sum, c) => sum + (c.unread || 0), 0);
  }, [conversations]);

  const filteredConvs = useMemo(() => {
    return (conversations || [])
      .filter(c => !c.isDraft && !String(c.id).startsWith('draft_'))
      .filter(c => {
        if (activeFilter === 'Unread') return (c.unread || 0) > 0 || (c.unreadCount || 0) > 0;
        if (activeFilter === 'DMs') return c.type !== 'GROUP' && !c.isGroup && !String(c.id).startsWith('c_');
        if (activeFilter === 'Groups') return c.type === 'GROUP' || c.isGroup || String(c.id).startsWith('c_');
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
    setIsModalOpen(false);
    if (!targetUser?.id) return;
    const existing = (conversations || []).find(c => {
      if (c.isGroup || String(c.id).startsWith('c_')) return false;
      const otherId = c.targetUser?.id || c.otherUser?.id || c.userId || c.participants?.find(p => String(p.userId || p.id) !== String(currentUser?.id))?.userId;
      return String(otherId) === String(targetUser.id);
    });
    if (existing?.publicId || existing?.id) {
      handleSelectChat(existing.publicId || existing.id);
    } else {
      navigate(`${MESSAGES_BASE}/new?user=${targetUser.id}`, { state: { targetUser } });
    }
  };

  const handleCreateGroup = async (groupName, userIds) => {
    const newConvId = await createGroupConversation(groupName, userIds);
    setIsModalOpen(false);
    if (newConvId) handleSelectChat(newConvId);
  };


  const getConvType = (c) => {
    if (!c) return 'dm';
    if (c.type === 'GROUP' || c.isGroup || String(c.id).startsWith('c_') || c.isCampusGroup) return 'group';
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
            onRetryUpload: retryUpload,
            onCancelUpload: cancelUpload,
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
                notFound={isChatInvalid}
                {...paginationProps}
              />
            );
          }
          return (
            <DMChatArea
              key={activeKey}
              conversation={activeConv}
              onSendMessage={handleSendMessage}
              onReactMessage={reactToMessage}
              onClearChat={clearChat}
              onTogglePin={togglePinConversation}
              onBlockUser={toggleBlockUser}
              onBack={handleBack}
              showChatOnMobile={showChatOnMobile}
              isLoading={activeConv?.isDraft ? false : (isConversationsLoading || (isMessagesLoading && allMessages.length === 0))}
              notFound={isChatInvalid}
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
            onDelete={() => handleDeleteConversation(contextMenu.conv)}
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
