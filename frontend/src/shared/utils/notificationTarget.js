/**
 * Where a notification about content leads, as an in-app path — or null when
 * it is not about something with a page of its own.
 *
 * The Notifications page has always opened a comment notification at the
 * comment (`/post/<id>#comment-<id>`). The in-app toast and the Recent
 * Activity panel did not: the toast sent everything but messages and
 * activities to /notifications, and the panel opened the post without the
 * comment. This is the one table all three can agree on.
 */
const seg = (value) => encodeURIComponent(String(value));

function idOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function notificationTargetPath(notif) {
  if (!notif || typeof notif !== 'object') return null;
  const meta = notif.metadata && typeof notif.metadata === 'object' ? notif.metadata : {};
  const type = String(notif.type || '').toUpperCase();
  const entityType = String(notif.entityType || '').toUpperCase();

  const postId = idOrNull(meta.postId) || (entityType === 'POST' ? idOrNull(notif.entityId) : null);
  const commentId = idOrNull(meta.commentId) || (entityType === 'COMMENT' ? idOrNull(notif.entityId) : null);
  const communityId = idOrNull(meta.communityId)
    || (type.startsWith('COMMUNITY_') ? idOrNull(notif.entityId) : null);
  const activityId = idOrNull(meta.activityId)
    || (['JOIN_REQUEST', 'ACTIVITY_JOIN', 'ACTIVITY_INVITE'].includes(type) ? idOrNull(notif.entityId) : null);
  const username = idOrNull(notif.actor?.username) || idOrNull(meta.actorUsername) || idOrNull(meta.username);

  // Moderation notices open the community: the content they are about is gone.
  if (meta.kind === 'content_removed' || meta.kind === 'moderator_promotion') {
    return communityId ? `/communities/${seg(communityId)}` : null;
  }

  switch (type) {
    case 'FOLLOW':
    case 'FOLLOW_ACCEPTED':
      return username ? `/profile/${seg(username)}` : null;
    // A request is answered on the requests page, not on the requester's profile.
    case 'FOLLOW_REQUEST':
      return '/notifications/follow-requests';
    case 'LIKE':
    case 'POST_LIKE':
      return postId ? `/post/${seg(postId)}` : null;
    case 'COMMENT':
    case 'COMMENT_LIKE':
    case 'MENTION':
      if (postId && commentId) return `/post/${seg(postId)}#comment-${seg(commentId)}`;
      return postId ? `/post/${seg(postId)}` : null;
    case 'COMMUNITY_JOIN':
    case 'COMMUNITY_JOIN_REQUEST':
      return communityId ? `/communities/${seg(communityId)}` : null;
    case 'JOIN_REQUEST':
    case 'ACTIVITY_JOIN':
    case 'ACTIVITY_INVITE':
      return activityId ? `/crew/${seg(activityId)}` : null;
    default:
      if (postId) return `/post/${seg(postId)}`;
      return null;
  }
}
