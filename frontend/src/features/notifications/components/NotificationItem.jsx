import { useNavigate } from 'react-router-dom';
import FollowButton from '@shared/components/ui/FollowButton';
import Avatar from '@shared/components/avatar/Avatar';
import styles from './NotificationItem.module.css';
import { getMediaUrl } from '@shared/api/apiClient';

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

  const isActivityJoin = notifType === 'join_request' || notifType === 'activity_join';
  // Activity joins name the joiner by username, matching how the host knows them.
  const actorName = isActivityJoin
    ? (actor?.username || notif.actor?.username || notif.metadata?.actorUsername || 'Someone')
    : (actor?.name || actor?.displayName || actor?.username || notif.actor?.displayName || notif.actor?.username || notif.metadata?.actorDisplayName || notif.metadata?.actorName || notif.metadata?.actorUsername || 'Someone');
  // The thumbnail slot on the right: a post's media, or — for an activity-join
  // notification — the activity's own cover image.
  const activityName = notif.metadata?.activityName || null;
  const activityImage = notif.metadata?.activityImage || null;
  const rawPostMedia = notif.metadata?.postMedia || notif.metadata?.mediaUrl || notif.metadata?.postImage || notif.metadata?.thumbnailUrl || activityImage || null;
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
  } else if (notifType === 'join_request' || notifType === 'activity_join') {
    // Joining is direct — there is no approval step to report.
    displayText = 'joined your activity.';
  } else if (displayText.startsWith(actorName)) {
    displayText = displayText.substring(actorName.length).trim();
  }

  if (!displayText) {
    displayText = notif.title || '';
  }

  /**
   * Moderation notices are complete sentences, not "<name> <predicate>".
   *
   * Every other row here reads as an actor doing something — "Ana liked your
   * post" — so the name is rendered separately and the body is the predicate.
   * These two are the community acting, and their bodies are already whole
   * sentences ("Your post in Chess Club was removed by a moderator"). Rendered
   * the normal way they came out as "Mod Squad Your post in Chess Club was
   * removed by a moderator" — a broken sentence that also names the individual
   * moderator, which the wording deliberately avoids: a removal is the
   * community's decision, not one person's, and naming them invites the author
   * to take it up with them directly.
   */
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

  return (
    <div
      className={`${styles.item} ${isRead ? '' : styles.unread}`}
      onClick={() => onClick(notif)}
    >
      <div className={styles.avatarWrapper}>
        {/* The community, not the moderator — same reason the body does not
            name them. Falls back to the community's initial via Avatar. */}
        <Avatar
          src={isModerationNotice ? getMediaUrl(notif.metadata?.communityAvatar) || null : avatarSrc}
          name={isModerationNotice ? (notif.metadata?.communityName || 'Community') : actorName}
          size="40px"
        />
      </div>

      <div className={styles.content}>
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
        {isActivityJoin && activityName && (
          <div className={styles.subText}>{activityName}</div>
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
