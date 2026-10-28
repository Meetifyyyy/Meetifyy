/**
 * Two live updates that keep a conversation's state in step across devices
 * and across a group's admins, without a refetch of the whole list:
 *
 * - `conversation:prefs` — the viewer muted or pinned a conversation on
 *   another device. That device used to be the only one that knew: the
 *   others kept raising alerts and counting the badge for a chat muted on
 *   the phone until their list happened to refetch.
 * - `group:join_requests` — a group's pending requests changed (a new one,
 *   or one an admin answered). Admins used to see a new request only when
 *   they reopened the group; the event carries only the group's ids (the
 *   list holds names and photos), so the group's details are refetched.
 */
import { matchesConversationId } from './cacheUtils';
import { dropFromUnreadSummary, refreshUnreadSummary } from './unreadSummary';

const idsOf = (payload) =>
  [payload?.conversationId, payload?.publicId, payload?.internalId].filter(Boolean).map(String);

const matchesAny = (row, ids) => Boolean(row) && ids.some((id) => matchesConversationId(row, id));

export function applyOwnConversationPrefs(queryClient, payload) {
  const ids = idsOf(payload);
  if (!queryClient || ids.length === 0) return;
  const patch = {};
  if (typeof payload.muted === 'boolean') {
    patch.muted = payload.muted;
    patch.isMuted = payload.muted;
  }
  if (typeof payload.pinned === 'boolean') {
    patch.pinned = payload.pinned;
    patch.isPinned = payload.pinned;
    patch.pinnedAt = payload.pinnedAt ?? null;
  }
  if (Object.keys(patch).length === 0) return;
  queryClient.setQueryData(['conversations'], (old) =>
    Array.isArray(old) ? old.map((c) => (matchesAny(c, ids) ? { ...c, ...patch } : c)) : old,
  );
  // The badge's summary leaves muted chats out: muting drops one, unmuting
  // may bring one back that only the server knows the count of.
  if (payload.muted === true) dropFromUnreadSummary(queryClient, ids);
  else if (payload.muted === false) refreshUnreadSummary(queryClient);
}

export function refreshJoinRequests(queryClient, payload) {
  const ids = idsOf(payload);
  if (!queryClient || ids.length === 0) return;
  queryClient.invalidateQueries({
    queryKey: ['groupDetails'],
    predicate: (query) => matchesAny(query.state.data, ids) || ids.includes(String(query.queryKey[1])),
  });
}
