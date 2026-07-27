import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { timeAgo } from '@shared/utils/time';
import { Pin, VolumeX, CalendarDays, MapPin } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import styles from '../../../shared/components/sidebar/ConversationList.module.css';

export default function ActivityChatItem({ conv, activeChatId, onSelect, onContextMenu }) {
  const { currentUser } = useAuth();
  const isActive = String(conv.id) === String(activeChatId) || String(conv.publicId) === String(activeChatId) || String(conv.activityId) === String(activeChatId);
  const isUnread = conv.unread > 0;

  const activityDate = conv.activity?.startDate || conv.activity?.date || conv.date;
  const isHost = String(conv.hostId || conv.activity?.hostId) === String(currentUser?.id);

  const hasStarted = (() => {
    const status = (conv.activity?.status || conv.status || '').toUpperCase();
    if (status === 'IN_PROGRESS' || status === 'STARTED' || status === 'COMPLETED' || status === 'ENDED') {
      return true;
    }
    if (conv.messages?.some(m => String(m.text || m.payload?.text).includes('Activity has started!'))) {
      return true;
    }
    if (conv.activityHasStarted) return true;
    if (conv.hasStarted) return true;
    if (conv.activity?.hasStarted) return true;
    if (activityDate) {
      const d = new Date(activityDate);
      if (!isNaN(d.getTime())) {
        return d <= new Date();
      }
    }
    return false;
  })();

  const previewText = (() => {
    const lastMsgObj = (Array.isArray(conv.messages) && conv.messages.length > 0)
      ? conv.messages[conv.messages.length - 1]
      : conv.lastMessage;
    if (!lastMsgObj) {
      const rawFallback = conv.lastMessageText || conv.preview || conv.lastMsg || '';
      return rawFallback.replace(/^You:\s*@/, '@');
    }
    let text = lastMsgObj.text || lastMsgObj.payload?.text || '';
    if (!text && lastMsgObj.mediaUrl) {
      return lastMsgObj.mediaType === 'audio' ? '🎤 Voice message' : lastMsgObj.mediaType === 'video' ? '📹 Video' : '📷 Photo';
    }
    const isSystemMsg =
      lastMsgObj.type === 'system' ||
      lastMsgObj.type === 'SYSTEM' ||
      lastMsgObj.isSystem ||
      lastMsgObj.system === true ||
      (typeof text === 'string' && text.startsWith('@'));

    if (isSystemMsg) {
      return text.replace(/^You:\s*@/, '@');
    }

    const isMe = String(lastMsgObj.senderId || lastMsgObj.from) === String(currentUser?.id);
    const senderName = isMe ? 'You' : lastMsgObj.senderName || 'Member';
    if (senderName && text) return `${senderName}: ${text}`;
    return text;
  })();

  return (
    <div
      className={`${styles.convItem}${isActive ? ` ${styles.convItemActive}` : ''}`}
      onClick={() => onSelect(conv.id, conv)}
      onContextMenu={(e) => onContextMenu?.(e, conv.id)}
    >
      <div className={styles.convAvatar}>
        <div className={styles.activityAvatarWrapper}>
          <Avatar src={conv.avatar || conv.activity?.coverImage} name={conv.name} size="48px" isGroup={true} />
          <div className={styles.calendarBadge}>
            {hasStarted ? (
              <div className={styles.startedCalendarBadge}>
                <CalendarDays size={28} />
              </div>
            ) : (
              <CalendarIcon date={activityDate} />
            )}
          </div>
        </div>
      </div>

      <div className={styles.convInfo}>
        <div className={styles.convNameRow}>
          <span className={`${styles.convNameText} ${isUnread ? styles.convNameTextUnread : ''}`}>
            {conv.name}
          </span>
          {isHost && <span className={styles.tagActivity}>Host</span>}
        </div>

        {previewText && (
          <div className={`${styles.convPreview} ${isUnread ? styles.convPreviewUnread : ''}`}>
            {previewText}
          </div>
        )}
      </div>

      <div className={styles.convMeta}>
        <span className={`${styles.convTime} ${isUnread ? styles.convTimeUnread : ''}`}>
          {conv.timestamp ? timeAgo(conv.timestamp) : conv.time}
        </span>
        <div className={styles.convIndicators}>
          {conv.muted && <VolumeX size={12} className={styles.mutedIcon} />}
          {conv.pinned && <Pin size={12} className={styles.pinnedIcon} />}
          {isUnread && <span className={styles.convBadge}>{conv.unread > 99 ? '99+' : conv.unread}</span>}
        </div>
      </div>
    </div>
  );
}
