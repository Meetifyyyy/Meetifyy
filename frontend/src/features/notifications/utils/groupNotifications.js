/**
 * Collapses notifications that say the same thing about the same target into
 * one row — "Asha and 4 others liked your post" instead of five rows.
 *
 * Grouped, by target:
 *   LIKE          on one post
 *   COMMENT_LIKE  on one comment
 *   FOLLOW        all new followers (the target is "you")
 *   JOIN_REQUEST  on one activity
 * Everything else stays one row each: a comment, a reply, a mention or a
 * message carries its own words, and merging them would hide what was said.
 *
 * Runs per date section ("Today", "Yesterday", …), so a group never spans a
 * header. Order is unchanged: a group sits where its newest member was, which
 * is where the reader expects new activity to appear.
 *
 * Done on the client on purpose. The API still returns one row per
 * notification, so the installed app's frozen frontend keeps working, and
 * reading or deleting a single notification stays a single-row operation.
 */

const groupKey = (n) => {
  const type = (n.type || '').toUpperCase();
  const meta = n.metadata || {};
  switch (type) {
    case 'LIKE': {
      const postId = meta.postId || n.entityId;
      return postId ? `LIKE:${postId}` : null;
    }
    case 'COMMENT_LIKE': {
      const commentId = meta.commentId || n.entityId;
      return commentId ? `COMMENT_LIKE:${commentId}` : null;
    }
    case 'FOLLOW':
      return 'FOLLOW';
    case 'JOIN_REQUEST':
    case 'ACTIVITY_JOIN': {
      const activityId = n.entityId || meta.activityId;
      return activityId ? `JOIN:${activityId}` : null;
    }
    default:
      return null;
  }
};

const isUnread = (n) => !(n.read === true || n.readAt);

/**
 * @param {Array} items notifications in display order (newest first)
 * @returns {Array} the same notifications, grouped rows replaced by their
 *   newest member carrying `groupIds` (every member's id, newest first),
 *   `groupCount`, and `read`/`readAt` that read as unread while any member is.
 */
export function groupNotifications(items) {
  const out = [];
  const groups = new Map();
  for (const n of items) {
    const key = groupKey(n);
    if (!key) {
      out.push(n);
      continue;
    }
    const existing = groups.get(key);
    if (!existing) {
      const row = { lead: n, members: [n] };
      groups.set(key, row);
      out.push(row);
    } else {
      existing.members.push(n);
    }
  }
  return out.map((entry) => {
    if (!entry.members) return entry;
    const { lead, members } = entry;
    if (members.length === 1) return lead;
    const anyUnread = members.some(isUnread);
    return {
      ...lead,
      read: !anyUnread,
      readAt: anyUnread ? null : lead.readAt || true,
      groupIds: members.map((m) => m.id),
      groupCount: members.length,
    };
  });
}

/** "and 1 other" / "and 4 others", for a grouped row. */
export function othersLabel(groupCount) {
  const others = (groupCount || 1) - 1;
  if (others <= 0) return '';
  return `and ${others} ${others === 1 ? 'other' : 'others'}`;
}
