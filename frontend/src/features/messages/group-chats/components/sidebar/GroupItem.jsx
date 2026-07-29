import Avatar from '@shared/components/avatar/Avatar';
import { timeAgo } from '@shared/utils/time';
import { Pin, VolumeX, CalendarDays } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import styles from '../../../shared/components/sidebar/ConversationList.module.css';

export default function GroupItem({ conv, activeChatId, onSelect, onContextMenu }) {
  const { currentUser } = useAuth();
  const isActive = Boolean(activeChatId) && (
    String(conv.id) === String(activeChatId) ||
    (Boolean(conv.publicId) && String(conv.publicId) === String(activeChatId))
  );
  const isUnread = conv.unread > 0;
  const isCampusGroup = String(conv.id).startsWith('c_') || conv.isCampusGroup;

  const memberCount = conv.memberCount || conv.members?.length || conv.participants?.length || 0;
  const pendingCount = conv.pendingRequests?.length || conv.pendingCount || 0;

  const isActivityChat = !!(conv.isActivityChat || conv.activityId || String(conv.id).startsWith('act_'));
  const hasStarted = !!(conv.hasStarted || conv.activityHasStarted);

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
        <Avatar src={conv.avatar || conv.icon || conv.coverImage || conv.avatarUrl} name={conv.name} size="48px" isGroup={true} />
        {isActivityChat && (
          <span className={styles.activityCalendarBadge} title={hasStarted ? 'Activity in progress' : 'Activity group'}>
            <CalendarDays size={11} strokeWidth={hasStarted ? 0 : 2} fill={hasStarted ? 'currentColor' : 'none'} />
          </span>
        )}
        {pendingCount > 0 && (
          <span 
            style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              background: '#f59e0b',
              color: '#fff',
              fontSize: '0.62rem',
              fontWeight: 700,
              minWidth: '17px',
              height: '17px',
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid var(--color-bg-white, #fff)',
              zIndex: 3
            }}
            title={`${pendingCount} pending join request(s)`}
          >
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </div>

      <div className={styles.convInfo}>
        <div className={styles.convNameRow}>
          <span className={`${styles.convNameText} ${isUnread ? styles.convNameTextUnread : ''}`}>
            {conv.name}
          </span>
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
