import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@shared/components/avatar/Avatar';
import { canSeeOnlineStatus, canSeeLastSeen, formatLastSeen } from '@shared/utils/presence';
import styles from './ChatHeader.module.css';

export default function ChatHeader({
  conversation,
  currentUser,
  users,
  showChatOnMobile,
  onBack,
  onToggleSearch,
  isMutedNotifications,
  setIsMutedNotifications,
  setShowDetails,
  isActivityHost,
  handleEndActivityFromChat,
  onClearChat,
  onBlockUser
}) {
  const navigate = useNavigate();
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const isOwner = conversation.ownerId === currentUser?.id || conversation.hostId === currentUser?.id || isActivityHost;
  const isAdmin = isOwner || (conversation.admins || []).includes(currentUser?.id);
  const hasPendingRequests = conversation.pendingRequests && conversation.pendingRequests.length > 0;

  return (
    <div className={`${styles.msgChatHeader} ${showChatOnMobile ? styles.msgMobileHeaderVisible : ''}`}>
      <div className={styles.msgChatUser} onClick={() => setShowDetails(true)} style={{ cursor: 'pointer' }}>
        {onBack && (
          <button className={styles.msgBackBtn} onClick={(e) => { e.stopPropagation(); onBack(); }} title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
        )}
        {conversation.isActivityChat ? (
          <Avatar 
            src={conversation.avatar} 
            name={conversation.name} 
            size="38px" 
            isGroup={true} 
          />
        ) : (
          <Avatar 
            src={conversation.avatar} 
            name={conversation.name} 
            size="38px" 
            isGroup={conversation.isGroup} 
            isOnline={!conversation.isGroup && (() => {
              const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
              const canSee = targetUser ? canSeeOnlineStatus(currentUser, targetUser) : true;
              return canSee && targetUser?.isOnline;
            })()} 
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={styles.msgChatName}>
            <span className={styles.msgChatNameText}>{conversation.name}</span>
            {conversation.blocked && (
              <span className={styles.msgBlockedBadge}>Blocked</span>
            )}
            {isAdmin && hasPendingRequests && (
              <span 
                className={styles.msgRequestsBadge} 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setShowDetails(true); 
                }}
                title={`${conversation.pendingRequests.length} pending join request(s)`}
              >
                {conversation.pendingRequests.length} request{conversation.pendingRequests.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {!conversation.isActivityChat && (
            <div className={styles.msgChatStatus}>
              {(() => {
                if (conversation.status === 'Closed') {
                  return <span style={{ color: '#ef4444' }}>Closed</span>;
                }
                if (conversation.isGroup) {
                  return null;
                }
                
                const targetUser = Object.values(users).find(u => u.username === conversation.username || u.id === conversation.userId);
                const canSeeOnline = targetUser ? canSeeOnlineStatus(currentUser, targetUser) : true;
                const canSeeSeen = targetUser ? canSeeLastSeen(currentUser, targetUser) : true;
                
                if (canSeeOnline && targetUser?.isOnline) {
                  return 'Online';
                } else if (canSeeSeen && targetUser?.lastActive) {
                  return `Last seen ${formatLastSeen(targetUser.lastActive)}`;
                } else {
                  return 'Offline';
                }
              })()}
            </div>
          )}
        </div>
      </div>
      <div className={styles.msgChatActions} onClick={(e) => e.stopPropagation()}>

        <div style={{ position: 'relative' }}>
          <button 
            className={`${styles.msgChatActionBtn} ${showMoreMenu ? styles.msgChatActionBtnActive : ''}`} 
            title="More"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
            </svg>
          </button>
          {showMoreMenu && (
            <div className={styles.msgMoreDropdown}>
              <button 
                className={styles.msgDropdownItem} 
                onClick={() => { onToggleSearch(); setShowMoreMenu(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Find
              </button>
              <button 
                className={styles.msgDropdownItem} 
                onClick={() => { setIsMutedNotifications(!isMutedNotifications); setShowMoreMenu(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isMutedNotifications ? (
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0M1 1l22 22" />
                  ) : (
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                  )}
                </svg>
                {isMutedNotifications ? 'Unmute Alerts' : 'Mute Alerts'}
              </button>
              {conversation.isActivityChat ? (
                <>
                  <button 
                    className={styles.msgDropdownItem} 
                    onClick={() => { setShowDetails(true); setShowMoreMenu(false); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    Group Info
                  </button>
                  {isActivityHost && (
                    <button 
                      className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                      onClick={() => { setShowMoreMenu(false); handleEndActivityFromChat(); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      End Activity
                    </button>
                  )}
                </>
              ) : (
                <>
                  {conversation.isGroup ? (
                    <button 
                      className={styles.msgDropdownItem} 
                      onClick={() => { setShowDetails(true); setShowMoreMenu(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      Group Info
                    </button>
                  ) : (
                    <button 
                      className={styles.msgDropdownItem} 
                      onClick={() => { setShowDetails(true); setShowMoreMenu(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      Contact Info
                    </button>
                  )}
                  <button 
                    className={styles.msgDropdownItem} 
                    onClick={() => { onClearChat && onClearChat(); setShowMoreMenu(false); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Clear Chat
                  </button>
                  {!conversation.isGroup && (
                    <button 
                      className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                      onClick={() => { onBlockUser && onBlockUser(); setShowMoreMenu(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                      {conversation.blocked ? 'Unblock Contact' : 'Block Contact'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
