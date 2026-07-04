import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import { useData } from '../../context/DataContext';
import { useSimulatedFetch } from '../../hooks/useSimulatedFetch';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import Skeleton from '../common/Skeleton';
import { ErrorState, EmptyState } from '../common/StateViews';
import { MessageSquarePlus } from 'lucide-react';
import NewMessageModal from './NewMessageModal';
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
  const { startConversation, createGroupConversation, crewActivities } = useData();
  const [contextMenu, setContextMenu] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState('Chats');
  const goBack = useSmartBack();

  const filteredInputConvs = useMemo(() => {
    return (conversations || []).filter(c => {
      const isActChat = c.isActivityChat || c.isTemporary;
      
      if (selectedTab === 'Activity') {
        if (!isActChat) return false;
        
        // Setup proper logic to remove temporary chat 4 hours after activity finishes
        if (c.activityId && crewActivities) {
           const activity = crewActivities.find(a => a.id === c.activityId);
           if (activity && activity.date && activity.time) {
             // Mock parsing of activity date + time
             // We assume activity duration is roughly 2 hours for calculation
             const activityDateStr = `${activity.date} ${activity.time.split(' - ')[0]}`;
             const activityTime = new Date(activityDateStr).getTime();
             if (!isNaN(activityTime)) {
               const fourHoursMs = 4 * 60 * 60 * 1000;
               const durationMs = 2 * 60 * 60 * 1000; // rough duration
               // Filter out if current time is past (activity start + duration + 4 hours)
               if (Date.now() > activityTime + durationMs + fourHoursMs) {
                 return false;
               }
             }
           }
        }
        return true;
      } else {
        return !isActChat;
      }
    });
  }, [conversations, selectedTab, crewActivities]);

  const { isLoading, data: loadedConvs, error, retry } = useSimulatedFetch(filteredInputConvs, 800);

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
      <div className={styles.tabsRow}>
        {['Chats', 'Activity'].map(tab => (
          <button 
            key={tab} 
            className={`${styles.tabBtn} ${selectedTab === tab ? styles.activeTab : ''}`} 
            onClick={() => setSelectedTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className={styles.searchRow}>
        <div className={styles.msgConvSearch}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchIcon}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" className={styles.msgSearchInput} placeholder="Search conversations..." />
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

        {!isLoading && !error && loadedConvs && loadedConvs.length === 0 && (
          <div style={{ padding: '2rem 1rem' }}>
            <EmptyState 
              title="No messages yet" 
              message="Start a new conversation to connect with others." 
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              }
            />
          </div>
        )}

        {!isLoading && !error && loadedConvs && loadedConvs.map((conv) => (
          <div
            key={conv.id}
            className={`${styles.convItem}${activeChatId === conv.id ? ` ${styles.convItemActive}` : ''}`}
            onClick={() => onSelect(conv.id)}
            onContextMenu={(e) => handleContextMenu(e, conv.id)}
          >
            <div className={styles.convAvatar} style={{ background: isImageUrl(conv.avatar) ? 'none' : conv.color }}>
              {isImageUrl(conv.avatar) ? (
                <img src={conv.avatar} alt={conv.name} className={styles.convAvatarImg} />
              ) : (
                <DefaultAvatar />
              )}
              {conv.online && <span className={styles.convOnlineDot} />}
            </div>
            <div className={styles.convInfo}>
              <div className={styles.convName}>
                {conv.name}
                {conv.unread > 0 && <span className={styles.convBadge}>{conv.unread}</span>}
              </div>
              <div className={styles.convPreview}>{conv.lastMsg}</div>
            </div>
            <div className={styles.convTime}>{conv.time}</div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div 
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => setContextMenu(null)}>Mark as unread</button>
          <button onClick={() => setContextMenu(null)}>Mute notifications</button>
          <button className={styles.deleteBtn} onClick={() => setContextMenu(null)}>Delete chat</button>
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
