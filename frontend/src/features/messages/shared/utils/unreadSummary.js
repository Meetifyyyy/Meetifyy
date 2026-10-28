/**
 * The server's list of every conversation that raises the message badge
 * (`GET /api/messages/unread-summary`), for the rows the inbox has not loaded.
 *
 * The inbox loads one page of conversations and the badge was summed from
 * that page alone, so an unread chat further down raised nothing. Loaded rows
 * stay the source for their own counts (they update live); the summary only
 * fills in the rest. It is fetched only while the list is a full page, since a
 * shorter list already holds everything.
 *
 * An unloaded row changes when it is read (here or on another device), muted,
 * hidden or left, and each of those drops it or refetches the summary. A new
 * message brings its row into the loaded page. Each refetch of the list
 * refetches the summary, for rows that have just dropped out of the page.
 */
import { matchesConversationId } from './cacheUtils';

export const UNREAD_SUMMARY_KEY = ['unreadSummary'];

const idsOf = (ids) => (ids || []).filter(Boolean).map(String);

/** These conversations no longer raise the badge (read, hidden or left). */
export function dropFromUnreadSummary(queryClient, ids) {
  const keys = idsOf(ids);
  if (!queryClient || keys.length === 0) return;
  queryClient.setQueryData(UNREAD_SUMMARY_KEY, (old) => {
    if (!Array.isArray(old?.conversations)) return old;
    const next = old.conversations.filter((e) => !keys.some((id) => matchesConversationId(e, id)));
    return next.length === old.conversations.length ? old : { ...old, conversations: next };
  });
}

/** Something the summary decides on changed (a mute, a fresh list): ask again. */
export function refreshUnreadSummary(queryClient) {
  queryClient?.invalidateQueries({ queryKey: UNREAD_SUMMARY_KEY, exact: true });
}

/**
 * Adds the summary's counts for conversations the list has not loaded to the
 * totals summed from the loaded rows.
 */
export function withUnloadedUnread(totals, conversations, summary) {
  const entries = summary?.conversations;
  if (!Array.isArray(entries) || entries.length === 0) return totals;
  const loaded = new Set();
  (conversations || []).forEach((c) => {
    [c?.id, c?.publicId, c?.internalId].forEach((id) => id && loaded.add(String(id)));
  });
  let { dm, group } = totals;
  entries.forEach((e) => {
    if (!e || loaded.has(String(e.id)) || loaded.has(String(e.internalId))) return;
    const count = Math.max(0, Number(e.unread) || 0);
    if (e.isGroup) group += count;
    else dm += count;
  });
  return { dm, group, total: dm + group };
}
