/**
 * Whether an incoming message should raise the Instant Match unread badge.
 *
 * Pulled out of the provider deliberately. Every past version of this badge
 * was wrong in one of four ways — it counted the user's own message, it
 * counted a message from a session that had already ended, it counted the same
 * message twice because two socket listeners were attached, or it counted a
 * message the user was looking at — and none of those are visible in a
 * component that also owns state, effects and a socket subscription. As a pure
 * function the whole rule is four lines and can be tested exhaustively.
 *
 * @param {object} args
 * @param {object} args.message       the incoming message, as the server sends it
 * @param {string} [args.envelopeConversationId] conversation id from the event wrapper
 * @param {object|null} args.session  the current chat state, or null
 * @param {string} args.currentUserId the viewer
 * @param {boolean} args.isViewing    is the chat on screen right now
 * @param {Set<string>} args.counted  ids already counted for this session
 * @returns {{ count: boolean, markRead: boolean, messageId: string|null }}
 */
export function evaluateUnread({
  message,
  envelopeConversationId,
  session,
  currentUserId,
  isViewing,
  counted,
}) {
  const nothing = { count: false, markRead: false, messageId: null };
  if (!message || !session) return nothing;

  // Only the live session has unread state at all. An ended one has none by
  // definition, which is what stops a badge outliving the match it belongs to.
  if (!session.isActive || !session.conversationId) return nothing;

  // Scoped to this session's conversation, by every id the server may stamp a
  // message with. Matching on the pair of users instead is what let a previous
  // session's traffic badge the current one.
  const ids = [
    message.conversationId,
    message.publicId,
    message.internalId,
    envelopeConversationId,
  ].filter(Boolean).map(String);
  if (!ids.includes(String(session.conversationId))) return nothing;

  // Your own message is never unread — including the copy your other tab
  // receives for multi-device sync.
  const senderId = message.senderId || message.sender?.id;
  if (message.from === 'me') return nothing;
  if (senderId && currentUserId && String(senderId) === String(currentUserId)) return nothing;

  // Deduplicated by id, so a duplicated event — two listeners, a replay after
  // reconnect — moves the count once or not at all.
  const messageId = message.id || message.tempId || message.clientId || null;
  if (messageId && counted?.has(messageId)) return nothing;

  // Reading it right now is the same as having read it.
  if (isViewing) return { count: false, markRead: true, messageId };

  return { count: true, markRead: false, messageId };
}
