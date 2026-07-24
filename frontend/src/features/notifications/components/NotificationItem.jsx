import { useNavigate } from 'react-router-dom';
import FollowButton from '@shared/components/ui/FollowButton';
import Avatar from '@shared/components/avatar/Avatar';
import styles from './NotificationItem.module.css';

export default function NotificationItem({
  notif,
  actor,
  timeStr,
  onClick,
  onAcceptJoinRequest,
  onRejectJoinRequest
}) {
  const navigate = useNavigate();
  const notifType = (notif.type || '').toLowerCase();
  const isFollow = notifType === 'follow';
  const targetUsername = actor?.username || notif.actor?.username || notif.metadata?.actorUsername || notif.metadata?.username || '';

  const actorName = actor?.name || actor?.username || notif.actor?.displayName || notif.actor?.username || notif.metadata?.actorName || notif.metadata?.actorDisplayName || notif.metadata?.username || 'Someone';
  const postMedia = notif.metadata?.postMedia || notif.metadata?.mediaUrl || notif.metadata?.postImage || notif.metadata?.thumbnailUrl || null;

  let displayText = notif.body || notif.text || '';
  if (isFollow) {
    displayText = 'started following you.';
  } else if (notifType === 'like') {
    displayText = 'liked your post.';
  } else if (notifType === 'comment_like') {
    displayText = 'liked your comment.';
  } else if (notifType === 'comment') {
    if (notif.metadata?.isReply || displayText.includes('replied to your comment:')) {
      if (displayText.includes('replied to your comment:')) {
        displayText = displayText.substring(displayText.indexOf('replied to your comment:')).trim();
      } else {
        displayText = 'replied to your comment.';
      }
    } else if (displayText.includes('commented:')) {
      displayText = displayText.substring(displayText.indexOf('commented:')).trim();
    } else {
      displayText = 'commented on your post.';
    }
  } else if (notifType === 'mention') {
    displayText = 'mentioned you.';
  } else if (notifType === 'message') {
    displayText = 'sent you a message.';
  } else if (notifType === 'join_request') {
    displayText = 'requested to join your activity.';
  } else if (displayText.startsWith(actorName)) {
    displayText = displayText.substring(actorName.length).trim();
  }

  if (!displayText) {
    displayText = notif.title || '';
  }

  const isRead = notif.read === true || !!notif.readAt;

  return (
    <div
      className={`${styles.item} ${isRead ? '' : styles.unread}`}
      onClick={() => onClick(notif)}
    >
      <div className={styles.avatar}>
        <Avatar src={actor.avatar} name={actorName} size="34px" />
      </div>

      <div className={styles.content}>
        <div className={styles.textRow}>
          <span 
            className={styles.actorName}
            onClick={(e) => {
              if (targetUsername) {
                e.stopPropagation();
                navigate(`/profile/${targetUsername}`);
              }
            }}
            style={{ cursor: targetUsername ? 'pointer' : 'default' }}
          >
            {actorName}
          </span>
          {' '}
          <span className={styles.text}>{displayText}</span>
          {' '}
          <span className={styles.time}>• {timeStr}</span>
        </div>
        {notifType === 'activity_join_request' && (
          <div className={styles.joinBtnGroup}>
            <button 
              className={styles.joinAcceptBtn}
              onClick={(e) => {
                e.stopPropagation();
                onAcceptJoinRequest(notif.activityId, notif.actorId, notif.id);
              }}
            >
              Accept
            </button>
            <button 
              className={styles.joinRejectBtn}
              onClick={(e) => {
                e.stopPropagation();
                onRejectJoinRequest(notif.activityId, notif.actorId, notif.id);
              }}
            >
              Reject
            </button>
          </div>
        )}
      </div>

      <div className={styles.actionSlot}>
        {isFollow && targetUsername ? (
          <FollowButton targetUsername={targetUsername} size="sm" />
        ) : postMedia ? (
          <img src={postMedia} className={styles.previewImg} alt="" />
        ) : null}
      </div>
    </div>
  );
}
