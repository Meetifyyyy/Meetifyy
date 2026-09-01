/**
 * Whether a conversation can still be sent into.
 *
 * The chat list deliberately KEEPS a conversation whose other participant has
 * deleted their account — the history belongs to both people, and losing it
 * because the other person left would be the wrong outcome. It renders them as
 * "Deleted User" with the default avatar, which is right for the inbox.
 *
 * A picker is a different question. Share and invite modals are asking "where
 * do you want to send this", and the backend refuses a send to an unavailable
 * recipient with `RECIPIENT_UNAVAILABLE`. Offering that thread as a target
 * therefore presents a choice that can only end in an error — and, worse,
 * presents "Deleted User" as though it were somebody you could reach.
 *
 * So: visible in the inbox, absent from every picker. One predicate, used by
 * both, so the two cannot drift.
 */

/** True when this thread's counterpart no longer exists. */
export function isConversationUnavailable(conversation) {
  if (!conversation) return true;
  return Boolean(
    conversation.targetUserUnavailable || conversation.targetUser?.isDeleted
  );
}

/**
 * Threads that can be sent into.
 *
 * Groups are kept even when a member has deleted their account: the rest of
 * the group is still there to receive the message, and the backend only
 * refuses a one-to-one thread whose sole counterpart is gone.
 */
export function sendableConversations(conversations) {
  return (conversations || []).filter((c) => !isConversationUnavailable(c));
}

/** True when a user row should never appear in a picker. */
export function isUserUnavailable(user) {
  if (!user) return true;
  return Boolean(user.isDeleted || user.profileAvailable === false);
}

/**
 * Users that can be picked.
 *
 * The server already excludes unavailable accounts from `/api/users/connections`,
 * so this is a second line rather than the enforcement — it exists because these
 * lists are cached (20s server-side, 30s in React Query) and a response fetched
 * a moment before a deletion would otherwise keep offering that person until
 * both caches turn over.
 */
export function selectableUsers(users) {
  return (users || []).filter((u) => u && u.id && !isUserUnavailable(u));
}
