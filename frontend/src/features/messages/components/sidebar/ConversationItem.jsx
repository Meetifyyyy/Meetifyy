import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { timeAgo } from '@shared/utils/time';
import { Pin, VolumeX, CalendarDays } from 'lucide-react';
import styles from './ConversationList.module.css';

export default function ConversationItem({ conv, activeChatId, onSelect, onContextMenu }) {
  const isCampusGroup = String(conv.id).startsWith('c_');
  const cleanAid = activeChatId != null ? String(activeChatId).replace(/^(act_)+/, '') : null;
  const cleanCid = String(conv.id).replace(/^(act_)+/, '');
  const cleanActId = conv.activityId ? String(conv.activityId).replace(/^(act_)+/, '') : null;
  const isMatch = cleanAid != null && (cleanCid === cleanAid || cleanActId === cleanAid);
  const isUnread = conv.unread > 0;

  const hasStarted = (() => {
    if (!conv.activity?.date) return false;
    return new Date(conv.activity.date) <= new Date();
  })();

  return (
    <div
      className={`${styles.convItem}${isMatch ? ` ${styles.convItemActive}` : ''}`}
      onClick={() => onSelect(conv.id)}
      onContextMenu={(e) => onContextMenu(e, conv.id)}
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
              {hasStarted ? (
                <div className={styles.startedCalendarBadge}>
                  <CalendarDays size={30} />
                </div>
              ) : (
                <CalendarIcon 
                  date={conv.activity?.date} 
                  dateLabel={conv.activity?.dateLabel || conv.dateLabel} 
                />
              )}
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
}
