import { useState } from 'react';
import { ArrowLeft, MoreVertical, Search, BellOff, BellRing, LogOut, Info, Settings, Trash2, Pin, CalendarDays } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/hooks/useData';
import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from '../../../shared/components/chat/ChatHeader.module.css';

export default function GroupChatHeader({ 
  conversation, 
  onBack, 
  onLeaveGroup, 
  onEndGroup,
  onClearChat, 
  onTogglePin,
  onToggleSearch, 
  onOpenDetails,
  onOpenSettings,
  isAdmin,
}) {
  const { currentUser } = useAuth();
  const { crewActivities = [] } = useData();
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(conversation?.muted || false);

  if (!conversation) return null;

  const isOwner = Boolean(
    isAdmin ||
    (currentUser?.id && (
      String(conversation?.ownerId) === String(currentUser.id) ||
      String(conversation?.hostId) === String(currentUser.id) ||
      String(conversation?.creatorId) === String(currentUser.id)
    ))
  );

  const isClosed = conversation.status === 'Closed' || conversation.isClosed;
  const memberCount = conversation.members?.length || conversation.participants?.length || conversation.memberCount || 0;
  const pendingRequests = conversation.pendingRequests || [];
  const hasPendingRequests = pendingRequests.length > 0;

  const isActivityChat = !!(conversation.isActivityChat || conversation.activityId || String(conversation.id).startsWith('act_'));
  const actStatus = (conversation.activity?.status || conversation.status || '').toUpperCase();
  const isEnded = actStatus === 'ENDED' || actStatus === 'CLOSED' || actStatus === 'COMPLETED' || actStatus === 'CANCELLED';

  const cleanActId = String(conversation.activityId || conversation.id || '').replace(/^act_/, '');
  const foundActivity = isActivityChat
    ? crewActivities.find(a => String(a.id) === cleanActId || String(a.activityId || '') === cleanActId)
    : null;

  const actDate = conversation.startDate || conversation.date || foundActivity?.startDate || foundActivity?.date || conversation.activity?.startDate;

  const formattedTiming = (() => {
    if (!isActivityChat) return null;
    const act = foundActivity || conversation.activity || conversation;
    const startRaw = act.startDate || act.date || conversation.activity?.startDate || conversation.startDate || conversation.date;
    if (!startRaw) return 'Activity';
    
    const startD = new Date(startRaw);
    if (isNaN(startD.getTime())) return String(startRaw);

    const endRaw = act.endDate || conversation.activity?.endDate || conversation.endDate;
    let endD = endRaw ? new Date(endRaw) : null;

    const startDateFormatted = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const startTimeStr = act.time || conversation.time || startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    let endTimeStr = act.endTime || conversation.endTime || (endD && !isNaN(endD.getTime()) ? endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : null);

    if (!endTimeStr && act.duration) {
      const durationHours = parseFloat(act.duration);
      if (!isNaN(durationHours)) {
        const calculatedEndD = new Date(startD.getTime() + durationHours * 3600 * 1000);
        endTimeStr = calculatedEndD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        if (!endD) endD = calculatedEndD;
      }
    }

    if (endTimeStr && endD && !isNaN(endD.getTime())) {
      const endDateFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (startDateFormatted === endDateFormatted) {
        return `${startDateFormatted} • ${startTimeStr} – ${endTimeStr}`;
      } else {
        return `${startDateFormatted} • ${startTimeStr} → ${endDateFormatted} • ${endTimeStr}`;
      }
    }

    return `${startDateFormatted} • ${startTimeStr}`;
  })();

  return (
    <div className={styles.msgChatHeader} onClick={onOpenDetails}>
      <button className={styles.msgBackBtn} onClick={(e) => { e.stopPropagation(); onBack(); }} aria-label="Back">
        <ArrowLeft size={20} />
      </button>

      <div className={`${styles.msgChatUser} ${styles.msgChatUserClickable}`}>
        <div style={{ position: 'relative', width: '38px', height: '38px', flexShrink: 0 }}>
          <Avatar src={conversation.avatar || conversation.icon || conversation.coverImage || conversation.avatarUrl} name={conversation.name} size="38px" isGroup />
          {isActivityChat && (
            isEnded ? (
              <span className={styles.activityCalendarBadge} title="Activity ended" style={{ position: 'absolute', bottom: '-4px', right: '-8px', width: '23px', height: '24px', borderRadius: '6px', background: '#18181b', color: '#ffffff', border: '3px solid var(--color-bg-white, #ffffff)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4, boxSizing: 'border-box' }}>
                <CalendarDays size={13} strokeWidth={2} />
              </span>
            ) : (
              <div style={{ position: 'absolute', bottom: '-4px', right: '-8px', zIndex: 4 }} title="Activity date">
                <CalendarIcon date={actDate} size="micro" style={{ width: '23px', height: '24px', borderRadius: '6px', boxSizing: 'border-box' }} />
              </div>
            )
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
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
            {isActivityChat
              ? (formattedTiming || 'Activity')
              : (memberCount > 0 ? `${memberCount} members` : 'Group')}
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

                  {isOwner ? (
                    <button 
                      className={styles.msgDropdownItem} 
                      onClick={() => { if (onEndGroup) onEndGroup(conversation.id); else if (onOpenDetails) onOpenDetails(); setShowMoreMenu(false); }}
                    >
                      <LogOut size={14} />
                      End Group
                    </button>
                  ) : (
                    onLeaveGroup && (
                      <button 
                        className={styles.msgDropdownItem} 
                        onClick={() => { onLeaveGroup(); setShowMoreMenu(false); }}
                      >
                        <LogOut size={14} />
                        Leave Group
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
