import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import { useData } from '../../context/DataContext';
import { useSimulatedFetch } from '../../hooks/useSimulatedFetch';
import Avatar from '../common/Avatar';
import Skeleton from '../common/Skeleton';
import CalendarIcon from '../common/CalendarIcon';
import { ErrorState, EmptyState } from '../common/StateViews';
import { MessageSquarePlus, CalendarDays, Pin, VolumeX } from 'lucide-react';
import NewMessageModal from './NewMessageModal';
import PageHeader from '../layout/PageHeader';
import { timeAgo } from '../../utils/time';
import styles from './ConversationList.module.css';

function ConversationSkeleton() {
  return (
    <div style={{ display: 'flex', padding: '0.8rem 1.25rem', alignItems: 'center', gap: '0.8rem', borderBottom: '1px solid var(--color-border-light)' }}>
      <Skeleton type="circle" width="48px" height="48px" />
      <div style={{ flex: 1 }}>
        <Skeleton type="text" width="50%" height="1rem" style={{ marginBottom: '6px' }} />
        <Skeleton type="text" width="80%" height="0.8rem" />
      </div>
    </div>
  );
}

export default function ConversationList({ conversations, activeChatId, onSelect, showChatOnMobile }) {
  const navigate = useNavigate();
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

  const { isLoading, data: loadedConvs, error, retry } = useSimulatedFetch(filteredInputConvs, 800);

  const searchedConvs = useMemo(() => {
    if (!searchVal.trim()) return loadedConvs || [];
    const term = searchVal.toLowerCase();
    return (loadedConvs || []).filter(c => 
      c.name.toLowerCase().includes(term) || 
      (c.lastMsg && c.lastMsg.toLowerCase().includes(term))
    );
  }, [loadedConvs, searchVal]);

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

        {!isLoading && !error && searchedConvs && searchedConvs.map((conv) => {
          const isCampusGroup = String(conv.id).startsWith('c_');
          const avatarRadius = (conv.isGroup || conv.isActivityChat || isCampusGroup) ? '12px' : '50%';
          const cleanAid = activeChatId != null ? String(activeChatId).replace(/^(act_)+/, '') : null;
          const cleanCid = String(conv.id).replace(/^(act_)+/, '');
          const cleanActId = conv.activityId ? String(conv.activityId).replace(/^(act_)+/, '') : null;
          const isMatch = cleanAid != null && (cleanCid === cleanAid || cleanActId === cleanAid);
          const isUnread = conv.unread > 0;

          const hasNotStarted = !!(conv.isActivityChat && conv.activity && conv.activity.date && new Date(conv.activity.date).getTime() > Date.now());
          let monthStr = '';
          let dayStr = '';
          if (hasNotStarted) {
            try {
              const d = new Date(conv.activity.date);
              if (!isNaN(d.getTime())) {
                monthStr = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
                dayStr = d.getDate();
              }
            } catch (e) {}
          }

          return (
            <div
              key={conv.id}
              className={`${styles.convItem}${isMatch ? ` ${styles.convItemActive}` : ''}`}
              onClick={() => onSelect(conv.id)}
              onContextMenu={(e) => handleContextMenu(e, conv.id)}
            >
              <div className={styles.convAvatar}>
                {conv.isActivityChat ? (
                  <div className={styles.activityAvatarWrapper}>
                    <Avatar 
                      src={conv.avatar} 
                      name={conv.name} 
                      size="48px" 
                      isGroup={true} 
                    />
                    <div className={styles.calendarBadge}>
                      <CalendarIcon 
                        date={conv.activity?.date} 
                        dateLabel={conv.activity?.dateLabel || conv.dateLabel} 
                      />
                    </div>
                  </div>
                ) : (
                  <Avatar 
                    src={conv.avatar} 
                    name={conv.name} 
                    size="48px" 
                    isGroup={conv.isGroup || isCampusGroup} 
                    isOnline={conv.online} 
                  />
                )}
              </div>
              <div className={styles.convInfo}>
                <div className={styles.convNameRow}>
                  <span className={`${styles.convNameText} ${isUnread ? styles.convNameTextUnread : ''}`}>{conv.name}</span>
                </div>
                {(() => {
                  let previewText = conv.lastMsg || '';
                  if (conv.isGroup || conv.isActivityChat) {
                    const lastMsgObj = conv.messages && conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
                    if (lastMsgObj && lastMsgObj.type !== 'system') {
                      const sender = lastMsgObj.from === 'me' 
                        ? 'You' 
                        : (lastMsgObj.senderName || 'Member');
                      previewText = `${sender}: ${lastMsgObj.text || conv.lastMsg}`;
                    }
                  }
                  return (
                    <div className={`${styles.convPreview} ${isUnread ? styles.convPreviewUnread : ''}`}>
                      {previewText}
                    </div>
                  );
                })()}
              </div>
              <div className={styles.convMeta}>
                <span className={`${styles.convTime} ${isUnread ? styles.convTimeUnread : ''}`}>
                  {conv.timestamp ? timeAgo(conv.timestamp) : conv.time}
                </span>
                <div className={styles.convIndicators}>
                  {conv.muted && <VolumeX size={12} className={styles.mutedIcon} />}
                  {conv.pinned && <Pin size={12} className={styles.pinnedIcon} />}
                  {isUnread && <span className={styles.convBadge}>{conv.unread}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <div 
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const targetConv = (conversations || []).find(c => c.id === contextMenu.convId);
            if (!targetConv) return null;
            return (
              <>
                <button onClick={() => {
                  markConversationUnread(contextMenu.convId, targetConv.unread === 0);
                  setContextMenu(null);
                }}>
                  {targetConv.unread > 0 ? 'Mark as read' : 'Mark as unread'}
                </button>
                <button onClick={() => {
                  togglePinConversation(contextMenu.convId);
                  setContextMenu(null);
                }}>
                  {targetConv.pinned ? 'Unpin chat' : 'Pin chat'}
                </button>
                <button onClick={() => {
                  toggleMuteConversation(contextMenu.convId);
                  setContextMenu(null);
                }}>
                  {targetConv.muted ? 'Unmute notifications' : 'Mute notifications'}
                </button>
                <button className={styles.deleteBtn} onClick={() => {
                  deleteConversation(contextMenu.convId);
                  setContextMenu(null);
                }}>
                  Delete chat
                </button>
              </>
            );
          })()}
        </div>
      )}

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
