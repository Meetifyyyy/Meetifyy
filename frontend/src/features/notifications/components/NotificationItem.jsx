import { useNavigate } from 'react-router-dom';
import FollowButton from '@shared/components/ui/FollowButton';
import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import styles from './NotificationItem.module.css';
import { getMediaUrl } from '@shared/api/apiClient';
import { DEFAULT_ACTIVITY_COVERS, getDefaultActivityCover } from '@shared/utils/activityCover';

export default function NotificationItem({
  notif,
  actor,
  timeStr,
  onClick,
}) {
  const navigate = useNavigate();
  const notifType = (notif.type || '').toLowerCase();
  const isFollow = notifType === 'follow';
  const targetUsername = actor?.username || notif.actor?.username || notif.metadata?.actorUsername || '';

  // Strictly "someone joined your activity" — exclude invites
  const isActivityJoin = notifType === 'join_request' || notifType === 'activity_join';
  // "Someone invited you to join an activity"
  const isActivityInvite = notifType === 'activity_invite';
  // Activity joins name the joiner by username, matching how the host knows them.
  const actorName = isActivityJoin
    ? (actor?.username || notif.actor?.username || notif.metadata?.actorUsername || notif.actor?.displayName || notif.metadata?.actorDisplayName || 'Someone')
    : (actor?.name || actor?.displayName || actor?.username || notif.actor?.displayName || notif.actor?.username || notif.metadata?.actorDisplayName || notif.metadata?.actorName || notif.metadata?.actorUsername || 'Someone');

  const activityName = notif.metadata?.activityName || notif.metadata?.activityTitle || notif.title || 'Activity';
  const activityImage = notif.metadata?.activityImage || null;
  const rawPostMedia = !isActivityJoin ? (notif.metadata?.postMedia || notif.metadata?.mediaUrl || notif.metadata?.postImage || notif.metadata?.thumbnailUrl || null) : null;
  const postMedia = rawPostMedia ? getMediaUrl(rawPostMedia) : null;

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
  } else if (isActivityJoin) {
    displayText = 'joined the activity.';
  } else if (isActivityInvite) {
    displayText = 'invited you to join.';
  } else if (displayText.startsWith(actorName)) {
    displayText = displayText.substring(actorName.length).trim();
  }

  if (!displayText) {
    displayText = notif.title || '';
  }

  const systemKind = notif.metadata?.kind;
  const isModerationNotice =
    systemKind === 'content_removed' || systemKind === 'moderator_promotion';

  const isRead = notif.read === true || !!notif.readAt;

  let avatarSrc;
  if (actor?.isLive || actor?.hasActor) {
    avatarSrc = actor.avatarUrl ?? actor.avatar;
  } else {
    avatarSrc = actor?.avatarUrl || actor?.avatar || notif.metadata?.actorAvatarUrl || notif.metadata?.actorAvatar;
  }

  const activityCoverSrc = activityImage ? getMediaUrl(activityImage) : getDefaultActivityCover(activityName || notif.entityId || '');
  const activityDate = notif.metadata?.activityDate || notif.metadata?.startDate || null;

  return (
    <div
      className={`${styles.item} ${isRead ? '' : styles.unread}`}
      onClick={() => onClick(notif)}
    >
      <div className={styles.avatarWrapper}>
        {(isActivityJoin || isActivityInvite) ? (
          <div className={styles.activityThumb}>
            <img
              src={activityCoverSrc}
              alt=""
              className={styles.activityAvatar}
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = DEFAULT_ACTIVITY_COVERS[0];
              }}
            />
            {/* Calendar date badge – bottom-right, matching CrewCard */}
            <div className={styles.calendarBadge}>
              <CalendarIcon
                date={activityDate}
                size="badge"
                style={{ border: '2.5px solid var(--color-bg-white, #ffffff)', boxShadow: 'none' }}
              />
            </div>
          </div>
        ) : isModerationNotice ? (
          <Avatar
            src={getMediaUrl(notif.metadata?.communityAvatar) || null}
            name={notif.metadata?.communityName || 'Community'}
            size="40px"
          />
        ) : (
          <Avatar
            src={avatarSrc}
            name={actorName}
            size="40px"
          />
        )}
      </div>

      <div className={styles.content}>
        {(isActivityJoin || isActivityInvite) ? (
          <>
            <div className={styles.textRow}>
              <strong className={styles.activityTitle}>{activityName}</strong>
              <span className={styles.time}>• {timeStr}</span>
            </div>
            <div className={styles.subTextRow}>
              <span
                className={styles.actorName}
                onClick={(e) => {
                  if (targetUsername) {
                    e.stopPropagation();
                    navigate(`/profile/${targetUsername}`, { state: { from: '/notifications' } });
                  }
                }}
                style={{ cursor: targetUsername ? 'pointer' : 'default' }}
              >
                {actorName}
              </span>
              <span className={styles.text}>{isActivityInvite ? 'invited you to join.' : 'joined the activity.'}</span>
            </div>
          </>
        ) : (
          <div className={styles.textRow}>
            {isModerationNotice ? (
              <span className={styles.text}>{displayText}</span>
            ) : (
              <>
                <span
                  className={styles.actorName}
                  onClick={(e) => {
                    if (targetUsername) {
                      e.stopPropagation();
                      navigate(`/profile/${targetUsername}`, { state: { from: '/notifications' } });
                    }
                  }}
                  style={{ cursor: targetUsername ? 'pointer' : 'default' }}
                >
                  {actorName}
                </span>
                <span className={styles.text}>{displayText}</span>
              </>
            )}
            <span className={styles.time}>• {timeStr}</span>
          </div>
        )}
      </div>

      {((isFollow && targetUsername) || postMedia) && (
        <div className={styles.actionSlot}>
          {isFollow && targetUsername ? (
            <div onClick={(e) => e.stopPropagation()}>
              <FollowButton targetUsername={targetUsername} size="sm" />
            </div>
          ) : postMedia ? (
            <img src={postMedia} className={styles.previewImg} alt="" />
          ) : null}
        </div>
      )}
    </div>
  );
}
