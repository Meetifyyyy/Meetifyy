/**
 * Which chat surface a payload belongs to.
 *
 * Instant Match conversations and normal DMs/groups look identical once a
 * message or a notification has been flattened into a payload, and they open
 * completely different screens: the Instant Match overlay versus
 * `/messages/<id>`. The server distinguishes them with `chatType`, so every
 * surface that routes a tap — the notifications list, the in-app message
 * toast, any deep link handler — asks the same question here rather than each
 * re-deriving it from a different field and disagreeing.
 *
 * Deliberately conservative: only an explicit `instant` marker counts.
 * Anything unmarked (an older server build, a payload from a path that does
 * not stamp it) routes to Messages, which is where the overwhelming majority
 * of messages belong and is the safe answer for a normal chat. The failure
 * mode of guessing "instant" wrongly is an overlay opening on an unrelated
 * conversation; the failure mode of guessing "normal" wrongly is the deep
 * link this project already had.
 */
export function isInstantChat(payload) {
  if (!payload) return false;
  return payload.chatType === 'instant' || payload.isInstantMatch === true;
}

/** The same question for a notification, whose fields live under `metadata`. */
export function isInstantChatNotification(notif) {
  if (!notif) return false;
  return isInstantChat(notif) || isInstantChat(notif.metadata);
}

/**
 * Is the Instant Match chat overlay currently on screen?
 *
 * Read from the DOM rather than from state on purpose. The one component that
 * knows this lives inside InstantMatchProvider, and the global SocketManager —
 * which needs the answer in order not to toast a message the user is already
 * looking at — is mounted above that provider and cannot subscribe to it. The
 * overlay is a portal into document.body carrying a stable class, so this is
 * a cheap and honest read of "is it visible right now".
 */
export function isInstantMatchChatOpen() {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('.im-chat-root'));
}
