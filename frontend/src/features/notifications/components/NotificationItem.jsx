import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import FollowButton from '@shared/components/ui/FollowButton';
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
  const isFollow = notif.type === 'follow';
  const targetUsername = actor.username || (actor.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  return (
    <div
      className={`${styles.item} ${notif.read ? '' : styles.unread}`}
      onClick={() => onClick(notif)}
    >
      <div className={styles.avatar}>
        {isImageUrl(actor.avatar) ? (
          <img src={actor.avatar} className={styles.avatarImg} alt="" />
        ) : (
          <DefaultAvatar />
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.textRow}>
          <span 
            className={styles.actorName}
            onClick={(e) => {
              if (actor.username) {
                e.stopPropagation();
                navigate(`/profile/${actor.username}`);
              }
            }}
            style={{ cursor: actor.username ? 'pointer' : 'default' }}
          >
            {actor.name}
          </span>
          {' '}
          <span className={styles.text}>{notif.text}</span>
          {' '}
          <span className={styles.time}>• {timeStr}</span>
        </div>
        {notif.type === 'ACTIVITY_JOIN_REQUEST' && (
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
        {isFollow ? (
          <FollowButton targetUsername={targetUsername} size="sm" />
        ) : (
          <div className={styles.previewImg} />
        )}
      </div>
    </div>
  );
}
