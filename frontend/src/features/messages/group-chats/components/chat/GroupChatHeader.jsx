import { useState } from 'react';
import { ArrowLeft, MoreVertical, Search, BellOff, BellRing, LogOut, Info, Settings } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import styles from '../../../shared/components/chat/ChatHeader.module.css';

export default function GroupChatHeader({ 
  conversation, 
  onBack, 
  onLeaveGroup, 
  onClearChat, 
  onToggleSearch, 
  onOpenDetails,
  onOpenSettings,
  isAdmin
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(conversation?.muted || false);

  if (!conversation) return null;

  const memberCount = conversation.members?.length || conversation.participants?.length || conversation.memberCount || 0;
  const pendingRequests = conversation.pendingRequests || [];
  const hasPendingRequests = pendingRequests.length > 0;

  return (
    <div className={styles.msgChatHeader}>
      <button className={styles.msgBackBtn} onClick={onBack} aria-label="Back">
        <ArrowLeft size={20} />
      </button>

      <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`} onClick={onOpenDetails}>
        <Avatar src={conversation.avatar} name={conversation.name} size="38px" isGroup />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={styles.msgChatName}>
            <span className={styles.msgChatNameText}>{conversation.name}</span>
            {isAdmin && hasPendingRequests && (
              <span 
                className={styles.msgRequestsBadge} 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onOpenDetails?.(); 
                }}
                title={`${pendingRequests.length} pending join request(s)`}
              >
                {pendingRequests.length} request{pendingRequests.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className={styles.msgChatStatus}>
            {memberCount > 0 ? `${memberCount} members` : 'Group'}
          </div>
        </div>
      </div>

      <div className={styles.msgChatActions} onClick={(e) => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <button 
            className={`${styles.msgChatActionBtn} ${showMoreMenu ? styles.msgChatActionBtnActive : ''}`} 
            title="More Options"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
          >
            <MoreVertical size={18} />
          </button>
          
          {showMoreMenu && (
            <div className={styles.msgMoreDropdown}>
              {onOpenDetails && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onOpenDetails(); setShowMoreMenu(false); }}
                >
                  <Info size={14} />
                  Group Info
                </button>
              )}
              {isAdmin && onOpenSettings && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onOpenSettings(); setShowMoreMenu(false); }}
                >
                  <Settings size={14} />
                  Group Settings
                </button>
              )}
              {onToggleSearch && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onToggleSearch(); setShowMoreMenu(false); }}
                >
                  <Search size={14} />
                  Find in chat
                </button>
              )}
              <button 
                className={styles.msgDropdownItem} 
                onClick={() => { setIsMuted(!isMuted); setShowMoreMenu(false); }}
              >
                {isMuted ? <BellRing size={14} /> : <BellOff size={14} />}
                {isMuted ? 'Unmute Alerts' : 'Mute Alerts'}
              </button>
              {onClearChat && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onClearChat(); setShowMoreMenu(false); }}
                >
                  <Info size={14} />
                  Clear Chat
                </button>
              )}
              {onLeaveGroup && (
                <button 
                  className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                  onClick={() => { onLeaveGroup(); setShowMoreMenu(false); }}
                >
                  <LogOut size={14} />
                  Leave Group
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
