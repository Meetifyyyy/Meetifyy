import { useState } from 'react';
import { ArrowLeft, MoreVertical, Search, BellOff, BellRing, Info, XCircle, LogOut, CalendarDays, CalendarX, Trash2, Pin } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from '../../../shared/components/chat/ChatHeader.module.css';
import sidebarStyles from '../../../shared/components/sidebar/ConversationList.module.css';

export default function ActivityChatHeader({ 
  conversation, 
  onBack, 
  onEndActivity, 
  onLeaveActivity,
  onClearChat,
  onTogglePin,
  onToggleSearch, 
  onOpenDetails,
  isHost: isHostProp,
  activityHasStarted,
  hasLeftGroup,
}) {
  const { currentUser } = useAuth();
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(conversation?.muted || false);

  if (!conversation) return null;

  const isOwner = Boolean(
    isHostProp ||
    (currentUser?.id && (
      String(conversation?.ownerId) === String(currentUser.id) ||
      String(conversation?.hostId) === String(currentUser.id) ||
      String(conversation?.creatorId) === String(currentUser.id) ||
      String(conversation?.activity?.hostId) === String(currentUser.id) ||
      String(conversation?.activity?.creatorId) === String(currentUser.id)
    ))
  );

  const isClosed = conversation.status === 'Closed' || conversation.status === 'ENDED' || conversation.status === 'CANCELLED' || conversation.isClosed || conversation.activity?.status === 'ENDED' || conversation.activity?.status === 'CANCELLED';

  const activityDate = conversation.activity?.startDate || conversation.activity?.date || conversation.date;
  const memberCount = conversation.members?.length || conversation.participants?.length || conversation.activity?.participants?.length || conversation.activity?.members?.length || conversation.memberCount || 0;
  const statusText = memberCount > 0 ? `${memberCount} member${memberCount === 1 ? '' : 's'}` : 'Activity Group';

  const hasStarted = (() => {
    const status = (conversation.activity?.status || conversation.status || '').toUpperCase();
    if (status === 'IN_PROGRESS' || status === 'STARTED' || status === 'COMPLETED' || status === 'ENDED') {
      return true;
    }
    if (conversation.messages?.some(m => String(m.text || m.payload?.text).includes('Activity has started!'))) {
      return true;
    }
    if (activityHasStarted) return true;
    if (conversation.activityHasStarted) return true;
    if (conversation.hasStarted) return true;
    if (conversation.activity?.hasStarted) return true;
    if (activityDate) {
      const d = new Date(activityDate);
      if (!isNaN(d.getTime())) {
        return d <= new Date();
      }
    }
    return false;
  })();

  return (
    <div className={styles.msgChatHeader} onClick={onOpenDetails}>
      <button className={styles.msgBackBtn} onClick={(e) => { e.stopPropagation(); onBack(); }} aria-label="Back">
        <ArrowLeft size={20} />
      </button>

      <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`}>
        <div style={{ position: 'relative', width: '38px', height: '38px', flexShrink: 0 }}>
          <Avatar src={conversation.avatar || conversation.activity?.coverImage} name={conversation.name} size="38px" isGroup />
          <div 
            style={{ 
              position: 'absolute', 
              bottom: '-3px', 
              right: '-3px', 
              transform: 'scale(0.42)', 
              transformOrigin: 'bottom right',
              zIndex: 2,
              borderRadius: '10px',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)'
            }}
          >
            {hasStarted ? (
              <div className={sidebarStyles.startedCalendarBadge}>
                <CalendarDays size={28} />
              </div>
            ) : (
              <CalendarIcon date={activityDate} />
            )}
          </div>
        </div>
        
        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <div className={styles.msgChatName}>
            <span className={styles.msgChatNameText}>{conversation.name}</span>
          </div>
          <div className={styles.msgChatStatus}>
            {statusText}
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

              {onTogglePin && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onTogglePin(conversation.id, conversation.pinned || conversation.isPinned); setShowMoreMenu(false); }}
                >
                  <Pin size={14} />
                  {conversation.pinned || conversation.isPinned ? 'Unpin Group' : 'Pin Group'}
                </button>
              )}

              {onClearChat && (
                <button 
                  className={styles.msgDropdownItem} 
                  onClick={() => { onClearChat(conversation.id); setShowMoreMenu(false); }}
                >
                  <Trash2 size={14} />
                  Clear Chat
                </button>
              )}

              {!isClosed && (
                <>
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

                  {isOwner ? (
                    !hasStarted ? (
                      <button 
                        className={styles.msgDropdownItem} 
                        onClick={() => { if (onEndActivity) onEndActivity(); else onOpenDetails(); setShowMoreMenu(false); }}
                      >
                        <CalendarX size={14} />
                        End Activity
                      </button>
                    ) : (
                      <button 
                        className={styles.msgDropdownItem} 
                        onClick={() => { if (onEndActivity) onEndActivity(); else onOpenDetails(); setShowMoreMenu(false); }}
                      >
                        <LogOut size={14} />
                        End Group
                      </button>
                    )
                  ) : (
                    !hasLeftGroup && (
                      <button 
                        className={styles.msgDropdownItem} 
                        onClick={() => { if (onLeaveActivity) onLeaveActivity(); else onOpenDetails(); setShowMoreMenu(false); }}
                      >
                        <LogOut size={14} />
                        {!hasStarted ? 'Leave Activity' : 'Leave Group'}
                      </button>
                    )
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
