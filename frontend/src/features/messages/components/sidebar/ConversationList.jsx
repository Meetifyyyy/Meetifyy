import { useState, useEffect, useMemo } from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useData } from '@shared/context/DataContext';
import { useSimulatedFetch } from '@shared/hooks/useSimulatedFetch';
import { useDebounce } from '@shared/hooks/useDebounce';
import { ErrorState, EmptyState } from '@shared/components/StateViews';
import { MessageSquarePlus } from 'lucide-react';
import NewMessageModal from '../modals/NewMessageModal';
import PageHeader from '@layout/PageHeader';
import styles from './ConversationList.module.css';

import ConversationSkeleton from './ConversationSkeleton';
import ConversationItem from './ConversationItem';
import ConversationContextMenu from './ConversationContextMenu';

export default function ConversationList({ conversations, activeChatId, onSelect, showChatOnMobile }) {
  const { 
    startConversation, 
    createGroupConversation, 
    crewActivities,
    togglePinConversation,
    toggleMuteConversation,
    markConversationUnread,
    deleteConversation 
  } = useData();
  const [contextMenu, setContextMenu] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchVal, setSearchVal] = useState('');
  const debouncedSearchVal = useDebounce(searchVal, 200);
  const goBack = useSmartBack();

  const totalUnread = useMemo(() => {
    return (conversations || []).reduce((sum, c) => sum + (c.unread || 0), 0);
  }, [conversations]);

  const filteredInputConvs = useMemo(() => {
    return (conversations || []).filter(c => {
      // Setup proper logic to remove temporary chat 4 hours after activity finishes
      if (c.isTemporary && c.activityId && crewActivities) {
         const activity = crewActivities.find(a => a.id === c.activityId);
         if (activity && activity.date && activity.time) {
           const activityDateStr = `${activity.date} ${activity.time.split(' - ')[0]}`;
           const activityTime = new Date(activityDateStr).getTime();
           if (!isNaN(activityTime)) {
             const fourHoursMs = 4 * 60 * 60 * 1000;
             const durationMs = 2 * 60 * 60 * 1000; // rough duration
             if (Date.now() > activityTime + durationMs + fourHoursMs) {
               return false;
             }
           }
         }
      }

      // Filter by activeFilter
      if (activeFilter === 'Unread') {
        return c.unread > 0;
      }
      if (activeFilter === 'DMs') {
        return !c.isGroup && !c.isActivityChat;
      }
      if (activeFilter === 'Groups') {
        return c.isGroup || c.isActivityChat;
      }
      return true;
    }).sort((a, b) => {
      // Pinned chats first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      // Chronological DESC
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
  }, [conversations, activeFilter, crewActivities]);

  const { isLoading, data: loadedConvs, error, retry } = useSimulatedFetch(filteredInputConvs, 350);

  const searchedConvs = useMemo(() => {
    if (!debouncedSearchVal.trim()) return loadedConvs || [];
    const term = debouncedSearchVal.toLowerCase();
    return (loadedConvs || []).filter(c => 
      c.name.toLowerCase().includes(term) || 
      (c.lastMsg && c.lastMsg.toLowerCase().includes(term))
    );
  }, [loadedConvs, debouncedSearchVal]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleContextMenu = (e, convId) => {
    e.preventDefault();
    setContextMenu({
      x: e.pageX,
      y: e.pageY,
      convId
    });
  };

  const handleStartChat = async (targetUser) => {
    const newConvId = await startConversation(targetUser);
    setIsModalOpen(false);
    onSelect(newConvId);
  };

  const handleCreateGroup = async (groupName, userIds) => {
    const newConvId = await createGroupConversation(groupName, userIds);
    setIsModalOpen(false);
    onSelect(newConvId);
  };

  return (
    <div className={`${styles.msgConvList}${showChatOnMobile ? ` ${styles.hideOnMobile}` : ''}`}>
      <div className={styles.mobileHeaderWrapper}>
        <PageHeader
          title="Messages"
          backPath="/home"
          searchProps={{
            value: searchVal,
            onChange: (e) => setSearchVal(e.target.value),
            placeholder: 'Search conversations...',
          }}
          actions={
            <button className={styles.msgNewBtn} title="New Message" onClick={() => setIsModalOpen(true)}>
              <MessageSquarePlus size={20} />
            </button>
          }
        />
        <div className={styles.filterRow}>
          {['All', 'Unread', 'DMs', 'Groups'].map(filter => {
            const showCount = filter === 'Unread' && totalUnread > 0;
            return (
              <button 
                key={filter} 
                className={`${styles.filterChip} ${activeFilter === filter ? styles.activeFilter : ''}`} 
                onClick={() => setActiveFilter(filter)}
              >
                {filter}{showCount ? ` (${totalUnread > 99 ? '99+' : totalUnread})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.desktopHeaderWrapper}>
        <div className={styles.msgConvHeader}>
          <div className={styles.titleGroup}>
            <button 
              className={styles.backBtn}
              onClick={() => goBack('/home')}
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
            <h2 className={styles.msgConvTitle}>Messages</h2>
          </div>
          <button className={styles.msgNewBtn} title="New Message" onClick={() => setIsModalOpen(true)}>
            <MessageSquarePlus size={20} />
          </button>
        </div>
        <div className={styles.filterRow}>
          {['All', 'Unread', 'DMs', 'Groups'].map(filter => {
            const showCount = filter === 'Unread' && totalUnread > 0;
            return (
              <button 
                key={filter} 
                className={`${styles.filterChip} ${activeFilter === filter ? styles.activeFilter : ''}`} 
                onClick={() => setActiveFilter(filter)}
              >
                {filter}{showCount ? ` (${totalUnread > 99 ? '99+' : totalUnread})` : ''}
              </button>
            );
          })}
        </div>
        <div className={styles.searchRow}>
          <div className={styles.msgConvSearch}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchIcon}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input 
              type="text" 
              className={styles.msgSearchInput} 
              placeholder="Search conversations..." 
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className={styles.msgConvScroll}>
        {isLoading && (
          <>
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
          </>
        )}

        {!isLoading && error && (
          <div style={{ padding: '2rem 1rem' }}>
            <ErrorState onRetry={retry} />
          </div>
        )}

        {!isLoading && !error && searchedConvs && searchedConvs.length === 0 && (
          <div style={{ padding: '2rem 1rem' }}>
            <EmptyState 
              title="No chats found" 
              message="No conversations match your search criteria." 
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
            />
          </div>
        )}

        {!isLoading && !error && searchedConvs && searchedConvs.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            activeChatId={activeChatId}
            onSelect={onSelect}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      <ConversationContextMenu
        contextMenu={contextMenu}
        conversations={conversations}
        onMarkUnread={markConversationUnread}
        onTogglePin={togglePinConversation}
        onToggleMute={toggleMuteConversation}
        onDelete={deleteConversation}
        onClose={() => setContextMenu(null)}
      />

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
