import { useState } from 'react';
import { ArrowLeft, MoreVertical, Search, BellOff, BellRing, Info, XCircle } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from '../../../shared/components/chat/ChatHeader.module.css';

export default function ActivityChatHeader({ 
  conversation, 
  onBack, 
  onEndActivity, 
  onToggleSearch, 
  onOpenDetails,
  isHost
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(conversation?.muted || false);

  if (!conversation) return null;

  const activityDate = conversation.activity?.date || conversation.activity?.startDate || conversation.date;
  const location = conversation.activity?.location || 'Activity';

  return (
    <div className={styles.msgChatHeader}>
      <button className={styles.msgBackBtn} onClick={onBack} aria-label="Back">
        <ArrowLeft size={20} />
      </button>

      <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`} onClick={onOpenDetails}>
        <div style={{ position: 'relative' }}>
          <Avatar src={conversation.avatar || conversation.activity?.coverImage} name={conversation.name} size="38px" isGroup />
          <div style={{ position: 'absolute', bottom: '-4px', right: '-4px', transform: 'scale(0.65)' }}>
            <CalendarIcon date={activityDate} />
          </div>
        </div>
        
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={styles.msgChatName}>
            <span className={styles.msgChatNameText}>{conversation.name}</span>
          </div>
          <div className={styles.msgChatStatus}>
            {location}
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
                  Activity Info
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
              {isHost && onEndActivity && (
                <button 
                  className={`${styles.msgDropdownItem} ${styles.msgDropdownItemDanger}`} 
                  onClick={() => { onEndActivity(); setShowMoreMenu(false); }}
                >
                  <XCircle size={14} />
                  End Activity
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
