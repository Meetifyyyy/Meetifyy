import Avatar from '@shared/components/avatar/Avatar';
import { timeAgo } from '@shared/utils/time';
import { Pin, VolumeX } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import styles from '../../../shared/components/sidebar/ConversationList.module.css';

export default function DMItem({ conv, activeChatId, onSelect, onContextMenu }) {
  const { currentUser } = useAuth();
  const isActive = String(conv.id) === String(activeChatId) || String(conv.publicId) === String(activeChatId);
  const isUnread = conv.unread > 0;

  const remainingTime = (() => {
    if (!conv.isInstantMatch || !conv.expiresAt) return '24h';
    const diff = new Date(conv.expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h left`;
    return `${mins}m left`;
  })();

  const previewText = (() => {
    const lastMsgObj = (Array.isArray(conv.messages) && conv.messages.length > 0) 
      ? conv.messages[conv.messages.length - 1] 
      : conv.lastMessage;
    if (!lastMsgObj) return conv.lastMessageText || conv.preview || conv.lastMsg || '';
    let text = lastMsgObj.text || lastMsgObj.payload?.text || '';
    if (!text && lastMsgObj.mediaUrl) {
      return lastMsgObj.mediaType === 'audio' ? '🎤 Voice message' : lastMsgObj.mediaType === 'video' ? '📹 Video' : '📷 Photo';
    }
    return text;
  })();

  return (
    <div
      className={`${styles.convItem}${isActive ? ` ${styles.convItemActive}` : ''}`}
      onClick={() => onSelect(conv.id, conv)}
      onContextMenu={(e) => onContextMenu?.(e, conv.id)}
    >
      <div className={styles.convAvatar}>
        <Avatar 
          src={conv.avatar} 
          name={conv.name} 
          size="48px" 
          isOnline={Boolean(conv.targetUser ? conv.targetUser.isOnline : (conv.online ?? conv.isOnline ?? false))} 
        />
      </div>

      <div className={styles.convInfo}>
        <div className={styles.convNameRow}>
          <span className={`${styles.convNameText} ${isUnread ? styles.convNameTextUnread : ''}`}>
            {conv.name}
            {conv.isInstantMatch && (
              <span className={styles.instantMatchBadge} title={`Expires in ${remainingTime}`}>
                ⚡ {remainingTime}
              </span>
            )}
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
