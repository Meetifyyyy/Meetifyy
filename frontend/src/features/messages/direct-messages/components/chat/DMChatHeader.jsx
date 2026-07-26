import { useState } from 'react';
import { ArrowLeft, MoreVertical, Search, BellOff, BellRing, Trash2, ShieldOff, Info } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import styles from '../../../shared/components/chat/ChatHeader.module.css';

export default function DMChatHeader({ 
  conversation, 
  onBack, 
  onBlock, 
  onClearChat, 
  onToggleSearch, 
  onOpenDetails 
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(conversation?.muted || false);

  if (!conversation) return null;

  const isOnline = conversation.isOnline || conversation.online;
  const isBlocked = conversation.isBlocked || conversation.blocked;

  return (
    <div className={styles.msgChatHeader}>
      <button className={styles.msgBackBtn} onClick={onBack} aria-label="Back">
        <ArrowLeft size={20} />
      </button>

      <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`} onClick={onOpenDetails}>
        <Avatar src={conversation.avatar} name={conversation.name} size="38px" isOnline={isOnline} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={styles.msgChatName}>
            <span className={styles.msgChatNameText}>{conversation.name}</span>
            {isBlocked && <span className={styles.msgBlockedBadge}>Blocked</span>}
          </div>
          <div className={`${styles.msgChatStatus} ${isOnline ? styles.msgStatusOnline : styles.msgStatusOffline}`}>
            {isOnline ? 'Online' : 'Offline'}
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
                  Contact Info
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
                  <Trash2 size={14} />
                  Clear Chat
                </button>
              )}
              {onBlock && (
                <button 
                  className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                  onClick={() => { onBlock(); setShowMoreMenu(false); }}
                >
                  <ShieldOff size={14} />
                  {isBlocked ? 'Unblock Contact' : 'Block Contact'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
