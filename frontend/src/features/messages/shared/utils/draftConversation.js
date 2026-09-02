/**
 * The conversation object for a thread that has no messages yet.
 *
 * A draft exists only in the URL: `/messages/new?user=<id>`. There is no
 * conversation row, no history and no entry in the conversation list, so every
 * screen that renders a chat has to be handed a shape it can treat like one.
 *
 * Extracted from MessagesLayout so the shape has a name and a test. The bug it
 * carried was invisible inside a 600-line component: the recipient was read
 * only from router state, which does not survive a reload, is absent on a
 * pasted link, and is dropped by some back/forward restorations. With it
 * missing the draft was named "New Message", and because ChatDetailsPanel
 * builds a synthetic user out of `name` when it has no `targetUser`, clicking
 * the header showed a profile called "New Message" instead of the person.
 *
 * `targetUser` is therefore a parameter here rather than something this
 * function reaches for: the caller resolves it from the id in the URL, which is
 * the only source that survives everything.
 */

/** The synthetic route id for a draft with `userId`. */
export function draftConversationId(userId) {
  return userId ? `draft_${userId}` : 'new';
}

/** True for the synthetic id above. */
export function isDraftConversationId(id) {
  return Boolean(id) && String(id).startsWith('draft_');
}

/** The user id encoded in a synthetic draft id, or null. */
export function draftUserIdFromConversationId(id) {
  return isDraftConversationId(id) ? String(id).replace('draft_', '') : null;
}

/**
 * Builds the draft conversation.
 *
 * @param {object}  args
 * @param {string}  args.conversationId Synthetic route id (`draft_<userId>`).
 * @param {string}  args.targetUserId   The recipient's id, from the URL.
 * @param {object?} args.targetUser     The recipient, once resolved. Null while
 *   the lookup is in flight, which is the only state in which this legitimately
 *   falls back to a placeholder name.
 * @param {object?} args.currentUser    The viewer, for the participants list.
 */
export function buildDraftConversation({
  conversationId,
  targetUserId,
  targetUser,
  currentUser,
  isBlockedByMe = false,
}) {
  const resolved = targetUser || null;

  return {
    id: conversationId,
    publicId: conversationId,
    type: 'DM',
    isDraft: true,
    targetUserId,
    targetUser: resolved,
    /**
     * `userId` and `username` are the fields ChatDetailsPanel matches on when
     * it looks the counterpart up in the users map. A draft used to carry
     * neither, so even with the map populated the panel could only fall back to
     * the synthetic user it builds out of `name`.
     */
    userId: targetUserId || null,
    username: resolved?.username || null,
    name: resolved?.displayName || resolved?.username || 'New Message',
    avatar: resolved?.avatar || null,
    /**
     * Empty until the recipient is known: a half-populated participants list
     * (the viewer alone) reads as a one-person conversation to anything that
     * counts it, which is worse than an empty one.
     */
    participants: resolved
      ? [
          { userId: currentUser?.id, user: currentUser },
          { userId: resolved.id, user: resolved },
        ]
      : [],
    /**
     * Block state, which a draft has to be told because it has no conversation
     * row to read it from.
     *
     * Blocking from an empty chat did reach the server, but every surface reads
     * `isBlockedByMe` off the conversation and the optimistic write only
     * touched the ['conversations'] cache, which a draft is not in. So the
     * composer stayed enabled and the menu still said "Block Contact".
     *
     * `blocked` is the mutual field the composer disables on. Only this side is
     * known here: whether THEY have blocked you cannot be observed from a
     * draft, and the server refuses the send either way.
     */
    isBlockedByMe: Boolean(isBlockedByMe),
    blocked: Boolean(isBlockedByMe),
  };
}
