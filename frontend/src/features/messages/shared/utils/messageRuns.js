import { checkIsMe, isSystemMessage } from './cacheUtils';

/**
 * Who a message is from, as one comparable key.
 *
 * Your own messages are all "me". In a direct chat everything else is the one
 * other person, whatever ids the message happens to carry (an optimistic or
 * socket-delivered message may lack some of them). In a group each other
 * member is their own author: two people on the left are two runs, not one.
 */
export function authorKey(msg, currentUser, isGroup) {
  if (checkIsMe(msg, currentUser)) return 'me';
  if (!isGroup) return 'them';
  const id = msg.senderId ?? msg.sender?.id ?? msg.sender?._id ?? msg.userId;
  return id == null || id === '' ? 'them' : `user:${String(id)}`;
}

/**
 * Does `msg` continue the run of `prev`, the row directly above it?
 *
 * A run is consecutive messages from the same author. Within one, rows sit
 * closer together (`--msg-gap-run`); where the author changes - a reply after a
 * message you sent, or one member after another - the thread keeps its full
 * `--msg-gap`. The caller passes `null` for `prev` when something else sits
 * between the two (a date separator), and a system notice never belongs to a
 * run, so neither of those can pull a message up against the row above it.
 *
 * Deliberately independent of what the message CONTAINS: text, voice, media and
 * every shared card are spaced by who sent them, not by their type.
 */
export function continuesRun(prev, msg, currentUser, isGroup) {
  if (!prev || !msg) return false;
  if (isSystemMessage(prev) || isSystemMessage(msg)) return false;
  return authorKey(prev, currentUser, isGroup) === authorKey(msg, currentUser, isGroup);
}

/**
 * Does this row open with a label above its bubble? A group member's row opens
 * with their name, and a reply to a post opens with "You replied to ...". Each
 * label has to stay nearer what it labels than the message above, so such a row
 * never closes up against the one above it.
 */
export function opensWithLabel(msg, currentUser, isGroup, hasPostReply) {
  return Boolean(hasPostReply) || (Boolean(isGroup) && !checkIsMe(msg, currentUser));
}

/**
 * For each item of the thread, whether that row closes up against the one above
 * it (`--msg-gap-run` instead of `--msg-gap`).
 *
 * `items` is the thread in order: `{ type: 'message', msg }` and anything else
 * (`{ type: 'date_separator' }`) that sits between messages. A row closes up
 * when both it and the item above are messages from the same author, neither is
 * a system notice, and the row does not open with a label. A date separator
 * between two messages is an item like any other, so a new day starts a new run.
 * `isPostReply` is passed in so this stays free of the component that owns it.
 */
export function closesUpFlags(items, { currentUser, isGroup, isPostReply = () => false }) {
  return items.map((row, i) => {
    const above = items[i - 1];
    if (!above || above.type !== 'message' || row.type !== 'message') return false;
    if (!continuesRun(above.msg, row.msg, currentUser, isGroup)) return false;
    return !opensWithLabel(row.msg, currentUser, isGroup, isPostReply(row.msg?.replyTo));
  });
}
