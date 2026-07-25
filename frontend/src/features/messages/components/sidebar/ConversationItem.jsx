import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { timeAgo } from '@shared/utils/time';
import { Pin, VolumeX, CalendarDays } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import styles from './ConversationList.module.css';

export default function ConversationItem({ conv, activeChatId, onSelect, onContextMenu }) {
  const { currentUser } = useAuth();
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

  const remainingTime = (() => {
    if (!conv.isInstantMatch || !conv.expiresAt) return '24h';
    const diff = new Date(conv.expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h left`;
    return `${mins}m left`;
  })();

  return (
    <div
      className={`${styles.convItem}${isMatch ? ` ${styles.convItemActive}` : ''}`}
      onClick={() => onSelect(conv.id, conv)}
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
          <span className={`${styles.convNameText} ${isUnread ? styles.convNameTextUnread : ''}`}>
            {conv.name}
            {conv.isInstantMatch && (
              <span className={styles.instantMatchBadge} title={`Expires in ${remainingTime}`}>
                ⚡ {remainingTime}
              </span>
            )}
          </span>
        </div>
        {(() => {
          let previewText = '';
          const lastMsgObj = (Array.isArray(conv.messages) && conv.messages.length > 0) 
            ? conv.messages[conv.messages.length - 1] 
            : conv.lastMessage;
          const isSystem = lastMsgObj?.type === 'system' || lastMsgObj?.type === 'SYSTEM' || lastMsgObj?.isSystem;

          if (lastMsgObj) {
            let text = lastMsgObj.text || lastMsgObj.payload?.text;
            if (lastMsgObj.inviteData || lastMsgObj.type === 'group_invite' || (typeof text === 'string' && text.startsWith('Join "') && text.includes('on Meetifyy'))) {
              const groupName = lastMsgObj.inviteData?.groupName;
              text = groupName ? `Group Invite: ${groupName}` : 'Group Invite';
            } else if (!text && lastMsgObj.mediaUrl) {
              text = lastMsgObj.mediaType === 'image' ? 'Photo' : lastMsgObj.mediaType === 'video' ? 'Video' : 'Audio';
            }

            if (text) {
              if ((conv.isGroup || conv.isActivityChat) && !isSystem) {
                const sId = lastMsgObj.senderId || lastMsgObj.from;
                const isMe = lastMsgObj.from === 'me' || (currentUser?.id && String(sId) === String(currentUser.id));

                let senderName = '';
                if (isMe) {
                  senderName = 'You';
                } else {
                  if (lastMsgObj.senderName && lastMsgObj.senderName !== 'Member') {
                    senderName = lastMsgObj.senderName;
                  } else if (lastMsgObj.sender?.displayName) {
                    senderName = lastMsgObj.sender.displayName;
                  } else if (lastMsgObj.sender?.username) {
                    senderName = lastMsgObj.sender.username;
                  } else {
                    const members = conv.members || conv.participants || [];
                    const found = members.find(m => {
                      const id = typeof m === 'string' ? m : (m.id || m.userId || m.user?.id);
                      return String(id) === String(sId);
                    });
                    if (found) {
                      const u = found.user || found;
                      senderName = u.displayName || u.username || u.name;
                    }
                  }
                  if (!senderName) senderName = lastMsgObj.senderName || 'Member';
                }

                previewText = `${senderName}: ${text}`;
              } else {
                previewText = text;
              }
            }
          } else if (conv.lastMsg) {
            let text = conv.lastMsg;
            if (typeof text === 'string' && text.startsWith('Join "') && text.includes('on Meetifyy')) {
              text = 'Group Invite';
            }
            const isLastMsgSystem = conv.lastMessage?.type === 'system' || conv.lastMessage?.type === 'SYSTEM' || conv.lastMessage?.isSystem;
            if ((conv.isGroup || conv.isActivityChat) && !isLastMsgSystem) {
              const sId = conv.lastSenderId || conv.lastMessage?.senderId;
              const isMe = (currentUser?.id && String(sId) === String(currentUser.id));

              let senderName = '';
              if (isMe) {
                senderName = 'You';
              } else {
                if (conv.lastSenderName && conv.lastSenderName !== 'Member') {
                  senderName = conv.lastSenderName;
                } else if (conv.lastMessage?.senderName && conv.lastMessage.senderName !== 'Member') {
                  senderName = conv.lastMessage.senderName;
                } else {
                  const members = conv.members || conv.participants || [];
                  const found = members.find(m => {
                    const id = typeof m === 'string' ? m : (m.id || m.userId || m.user?.id);
                    return String(id) === String(sId);
                  });
                  if (found) {
                    const u = found.user || found;
                    senderName = u.displayName || u.username || u.name;
                  }
                }
                if (!senderName) senderName = conv.lastSenderName || conv.lastMessage?.senderName || 'Member';
              }

              previewText = `${senderName}: ${text}`;
            } else {
              previewText = text;
            }
          }

          if (!previewText) return null;

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
