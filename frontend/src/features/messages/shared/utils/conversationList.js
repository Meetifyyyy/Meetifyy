/**
 * Live updates to the conversation list (`['conversations']`): a message
 * arriving or sent, a message unsent, a chat read on another device.
 *
 * Each of these used to be written in several places with their own rules,
 * and none of them were safe against the order or number of events:
 *
 * - every `message:new` added one to the unread count, so the same message
 *   delivered twice (a retry, a reconnect, a catch-up replay) counted twice;
 * - an older message arriving after a newer one replaced the row's preview
 *   and time with the older one, and moved the row to the top;
 * - unsending any message rewrote the row to "This message was unsent", even
 *   when a later message was the one the row showed;
 * - reading a chat on one device never cleared its badge on the others.
 *
 * The rules now: a row's preview and time only move forward (server times,
 * the message's own id as the tiebreak); a message is counted once; unsend
 * touches the row only when it was the row's message; a read clears the count
 * when nothing newer than it has arrived, and asks the server otherwise. The
 * list stays in activity order without rows jumping for stale events.
 */
import { matchesConversationId } from './cacheUtils';
import { messagePreviewText, UNSENT_PREVIEW } from './messagePreview';
import { dropFromUnreadSummary } from './unreadSummary';

const timeOf = (value) => {
  if (typeof value === 'number') return value;
  const t = typeof value === 'string' || value instanceof Date ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Messages already counted towards a row's unread total, so a repeat is not. */
const counted = new Set();
const COUNTED_LIMIT = 2000;
function countOnce(key) {
  if (counted.has(key)) return false;
  counted.add(key);
  if (counted.size > COUNTED_LIMIT) counted.delete(counted.values().next().value);
  return true;
}

/** Test seam, and sign-out: forget which messages were counted. */
export function resetConversationListMemory() {
  counted.clear();
}

const rowTime = (c) => Math.max(timeOf(c.timestamp), timeOf(c.lastMessage?.createdAt), timeOf(c.updatedAt));

const sameMessage = (a, b) =>
  Boolean(a && b && (
    (a.id && b.id && String(a.id) === String(b.id))
    || (a.clientId && b.clientId && String(a.clientId) === String(b.clientId))
  ));

function findRow(list, ids) {
  return list.findIndex((c) => ids.some((id) => matchesConversationId(c, id)));
}

/**
 * Applies a message to its conversation's row.
 *
 * @param {object} message a chat message (server or optimistic)
 * @param {{ countUnread?: boolean }} [options] add it to the unread count
 *   (once per message), for someone else's message the viewer is not looking at
 * @returns {'updated' | 'stale' | 'missing'} 'missing' when the list has no row
 *   for it (the caller refetches the list); 'stale' when the row already shows
 *   something newer and there was nothing to count
 */
export function applyMessageToConversationList(queryClient, message, { countUnread = false } = {}) {
  const ids = [message?.conversationId, message?.publicId, message?.internalId].filter(Boolean);
  if (!queryClient || ids.length === 0) return 'missing';
  let outcome = 'missing';
  queryClient.setQueryData(['conversations'], (old) => {
    if (!Array.isArray(old)) return old;
    const idx = findRow(old, ids);
    if (idx === -1) return old;
    const row = old[idx];
    const at = timeOf(message.createdAt) || Date.now();
    const shown = row.lastMessage;
    const current = timeOf(shown?.createdAt);
    const isShown = sameMessage(message, shown);
    // Forward only. Equal times are ordered by id, the server's own tiebreak.
    const newer = isShown
      || !current
      || at > current
      || (at === current && String(message.id || '') >= String(shown?.id || ''));
    const count = countUnread && message.id
      ? countOnce(`${row.internalId || row.id}|${message.id}`)
      : false;
    if (!newer && !count) {
      outcome = 'stale';
      return old;
    }
    const unread = Math.max(0, (row.unreadCount ?? row.unread ?? 0) + (count ? 1 : 0));
    const next = { ...row, unreadCount: unread, unread };
    if (newer) {
      const text = messagePreviewText(message);
      next.lastMessage = { ...message, text };
      next.lastMsg = text;
      next.lastMessageText = text;
      // The device's own optimistic copy keeps the row where it is; the
      // server's copy of it brings the server's time, so a device whose clock
      // runs ahead cannot make later messages from others look older.
      const time = isShown && message.isOptimistic ? Math.max(at, current) : at;
      next.updatedAt = new Date(time).toISOString();
      next.timestamp = time;
    }
    outcome = 'updated';
    const list = [...old];
    list[idx] = next;
    // Activity order, stable for equal times: only a newer message moves a row.
    return newer ? list.sort((a, b) => rowTime(b) - rowTime(a)) : list;
  });
  return outcome;
}

/**
 * A message was unsent. Its row changes only if that message is the one the
 * row shows (matched by id, or by time where the row has no id for it).
 */
export function markUnsentInConversationList(queryClient, { ids, messageId, createdAt }) {
  const keys = (ids || []).filter(Boolean);
  if (!queryClient || keys.length === 0) return;
  queryClient.setQueryData(['conversations'], (old) => {
    if (!Array.isArray(old)) return old;
    const idx = findRow(old, keys);
    if (idx === -1) return old;
    const row = old[idx];
    const shown = row.lastMessage;
    const isShown = shown && (
      (shown.id && String(shown.id) === String(messageId))
      || (!shown.id && createdAt && timeOf(shown.createdAt) === timeOf(createdAt))
    );
    if (!isShown) return old;
    const list = [...old];
    list[idx] = {
      ...row,
      lastMessage: { ...shown, text: UNSENT_PREVIEW, state: 'UNSENT', isUnsent: true },
      lastMsg: UNSENT_PREVIEW,
      lastMessageText: UNSENT_PREVIEW,
    };
    return list;
  });
}

/**
 * The viewer read a conversation (on this device or another). Clears its
 * count if nothing arrived after the read; if something did, the count is
 * not knowable here and the list is refetched instead.
 *
 * @returns {boolean} whether the list should be refetched
 */
export function applyReadToConversationList(queryClient, { ids, readAt }) {
  const keys = (ids || []).filter(Boolean);
  if (!queryClient || keys.length === 0) return false;
  // A row the list has not loaded stops raising the badge (anything newer
  // than this read would have brought it into the list).
  dropFromUnreadSummary(queryClient, keys);
  const readTime = timeOf(readAt);
  let refetch = false;
  queryClient.setQueryData(['conversations'], (old) => {
    if (!Array.isArray(old)) return old;
    const idx = findRow(old, keys);
    if (idx === -1) return old;
    const row = old[idx];
    if (!(row.unreadCount || row.unread)) return old;
    if (readTime && timeOf(row.lastMessage?.createdAt) > readTime) {
      refetch = true;
      return old;
    }
    const list = [...old];
    list[idx] = { ...row, unreadCount: 0, unread: 0 };
    return list;
  });
  return refetch;
}

/**
 * A message was deleted for this viewer. If it is the one their row shows,
 * the row falls back to `replacement` (the newest message they still have),
 * moving back in the list accordingly. With no replacement at hand the
 * caller refetches the list; the server skips deleted-for-me messages when it
 * builds a preview.
 *
 * @returns {boolean} whether the list should be refetched
 */
export function replaceDeletedPreview(queryClient, { ids, messageId, replacement }) {
  const keys = (ids || []).filter(Boolean);
  if (!queryClient || keys.length === 0) return false;
  let refetch = false;
  queryClient.setQueryData(['conversations'], (old) => {
    if (!Array.isArray(old)) return old;
    const idx = findRow(old, keys);
    if (idx === -1) return old;
    const row = old[idx];
    if (!row.lastMessage?.id || String(row.lastMessage.id) !== String(messageId)) return old;
    if (!replacement) {
      refetch = true;
      return old;
    }
    const text = messagePreviewText(replacement);
    const time = timeOf(replacement.createdAt);
    const list = [...old];
    list[idx] = {
      ...row,
      lastMessage: { ...replacement, text },
      lastMsg: text,
      lastMessageText: text,
      ...(time ? { updatedAt: new Date(time).toISOString(), timestamp: time } : {}),
    };
    return list.sort((a, b) => rowTime(b) - rowTime(a));
  });
  return refetch;
}

/** The newest message in a chat's loaded history, other than `exceptId`. */
export function newestLoadedMessage(queryClient, conversationId, exceptId) {
  const pages = queryClient?.getQueryData(['messages', conversationId])?.pages || [];
  let best = null;
  pages.forEach((page) => (page?.messages || []).forEach((m) => {
    if (!m || (exceptId && String(m.id) === String(exceptId))) return;
    if (m.status === 'failed' || m.status === 'sending') return;
    if (!best || timeOf(m.createdAt) > timeOf(best.createdAt)) best = m;
  }));
  return best;
}
