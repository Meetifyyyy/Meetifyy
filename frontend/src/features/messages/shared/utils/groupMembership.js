/**
 * Group membership on this device: applying a change, and deciding which of
 * two statements about it is the current one.
 *
 * Membership reaches the client by several routes that can arrive in any
 * order — the `group:member_*` socket events, the conversation list, the
 * history response of an open chat — and each used to be applied as it came.
 * A late list response or a repeated event could therefore undo a newer
 * change, and the removed user's composer could come back. Every statement
 * now carries `membershipChangedAt`, the server's time of the change it
 * describes (when the user last joined, or left), and the newest one wins.
 * A statement with no stamp (a server from before this field) is applied as
 * before, so nothing regresses during a deploy.
 *
 * Removal is also where a cached copy can grant what the server no longer
 * does: the group's details (`['groupDetails', id]`) carried the viewer's
 * `myRole`, and the chat screen read "has a role" as "is a member". That copy
 * is dropped the moment the viewer is out, not merely marked stale — a
 * disabled query keeps its data, and that data was what kept the composer
 * open until the app was restarted.
 */
import { matchesConversationId } from './cacheUtils';
import { dropFromUnreadSummary } from './unreadSummary';

/** The server's refusal code for a request from someone no longer in the conversation. */
export const NOT_A_MEMBER = 'NOT_A_MEMBER';

const timeOf = (value) => {
  const t = typeof value === 'string' || typeof value === 'number' ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Whether a statement stamped `changedAt` may replace what `held` says.
 * Unstamped statements always may (older servers); a stamped one may unless
 * `held` carries a strictly newer stamp.
 */
export function isCurrentMembership(held, changedAt) {
  const incoming = timeOf(changedAt);
  if (!incoming) return true;
  return incoming >= timeOf(held?.membershipChangedAt);
}

/**
 * Of two membership statements about the viewer (each `{ isMember,
 * membershipChangedAt }`, either possibly missing), the current one. Used
 * where the list row and the history response both describe an open chat.
 */
export function newerMembership(a, b) {
  const hasA = typeof a?.isMember === 'boolean';
  const hasB = typeof b?.isMember === 'boolean';
  if (!hasB) return hasA ? a : null;
  if (!hasA) return b;
  const ta = timeOf(a.membershipChangedAt);
  const tb = timeOf(b.membershipChangedAt);
  if (ta === tb) {
    // The same moment described twice: only a disagreement matters, and then
    // the cautious answer is the one that does not offer a composer.
    return a.isMember === b.isMember ? a : { ...a, isMember: false };
  }
  return tb > ta ? b : a;
}

const groupDetailsFor = (queryClient, ids) =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: ['groupDetails'] })
    .filter((query) => {
      const key = query.queryKey?.[1];
      if (key != null && ids.some((id) => String(id) === String(key))) return true;
      return ids.some((id) => matchesConversationId(query.state.data, id));
    });

/**
 * The viewer was added to, or taken out of, a group.
 *
 * Patches the conversation list row and the open chat's history page (the two
 * places the chat screen reads membership from), each only when this change
 * is newer than what it holds. Leaving drops the group's cached details
 * outright and cancels any fetch of them in flight.
 *
 * @returns {boolean} whether anything on this device changed
 */
export function applyOwnMembership(queryClient, { ids, isMember, changedAt, status }) {
  const keys = (ids || []).filter(Boolean).map(String);
  if (!queryClient || keys.length === 0) return false;
  const matches = (c) => keys.some((id) => matchesConversationId(c, id));
  const stamp = changedAt || null;
  let changed = false;

  queryClient.setQueryData(['conversations'], (old) => {
    if (!Array.isArray(old)) return old;
    let touched = false;
    const next = old.map((c) => {
      if (!matches(c) || !isCurrentMembership(c, stamp)) return c;
      if (c.isMember === isMember && (!stamp || c.membershipChangedAt === stamp)) return c;
      touched = true;
      return {
        ...c,
        isMember,
        // 'LEFT' when they left by choice, so the chat does not tell them
        // they were removed.
        myMembershipStatus: isMember ? 'MEMBER' : (status || 'KICKED'),
        leftAt: isMember ? null : (stamp || c.leftAt || new Date().toISOString()),
        // Nothing in a group they have left counts (the server agrees).
        ...(isMember ? {} : { unreadCount: 0, unread: 0 }),
        ...(stamp ? { membershipChangedAt: stamp } : {}),
      };
    });
    if (touched) changed = true;
    return touched ? next : old;
  });

  keys.forEach((id) => {
    queryClient.setQueryData(['messages', id], (old) => {
      const first = old?.pages?.[0];
      if (!first || !isCurrentMembership(first, stamp)) return old;
      if (first.isMember === isMember && (!stamp || first.membershipChangedAt === stamp)) return old;
      changed = true;
      const pages = [...old.pages];
      pages[0] = {
        ...first,
        isMember,
        ...(isMember ? {} : { canSendMessages: false }),
        ...(stamp ? { membershipChangedAt: stamp } : {}),
      };
      return { ...old, pages };
    });
  });

  if (!isMember) {
    // Nothing in a group they have left counts, loaded in the list or not.
    dropFromUnreadSummary(queryClient, keys);
    groupDetailsFor(queryClient, keys).forEach((query) => {
      void queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
      changed = true;
    });
  }

  return changed;
}

/**
 * Event keys already applied to the member count, so a repeated or replayed
 * event cannot move it twice. Bounded: only the recent past can repeat.
 */
const appliedCountChanges = new Set();
const APPLIED_LIMIT = 500;

/**
 * Someone else joined or left a group the viewer is in: the list row's member
 * count moves once per change, and the cached details drop a departed member
 * from their roster at once (the refetch that follows fills in a new one).
 */
export function applyOthersMembership(queryClient, { ids, userId, joined, changedAt }) {
  const keys = (ids || []).filter(Boolean).map(String);
  if (!queryClient || keys.length === 0 || !userId) return;
  const matches = (c) => keys.some((id) => matchesConversationId(c, id));

  if (changedAt) {
    const eventKey = `${keys[0]}|${userId}|${joined ? 'in' : 'out'}|${changedAt}`;
    if (appliedCountChanges.has(eventKey)) return;
    appliedCountChanges.add(eventKey);
    if (appliedCountChanges.size > APPLIED_LIMIT) {
      appliedCountChanges.delete(appliedCountChanges.values().next().value);
    }
  }

  queryClient.setQueryData(['conversations'], (old) => {
    if (!Array.isArray(old)) return old;
    return old.map((c) => {
      // The viewer is out of this group themselves: its roster is no longer theirs to follow.
      if (!matches(c) || c.isMember === false || c.myMembershipStatus === 'KICKED' || c.myMembershipStatus === 'LEFT') return c;
      const count = c.memberCount || c.membersCount || 0;
      const next = joined ? count + 1 : Math.max(0, count - 1);
      return { ...c, memberCount: next, membersCount: next };
    });
  });

  if (!joined) {
    const uid = String(userId);
    groupDetailsFor(queryClient, keys).forEach((query) => {
      queryClient.setQueryData(query.queryKey, (old) => {
        if (!old || !Array.isArray(old.memberDetails)) return old;
        const memberDetails = old.memberDetails.filter((m) => String(m?.userId ?? m?.id) !== uid);
        if (memberDetails.length === old.memberDetails.length) return old;
        return {
          ...old,
          memberDetails,
          members: Array.isArray(old.members) ? old.members.filter((id) => String(id) !== uid) : old.members,
          admins: Array.isArray(old.admins) ? old.admins.filter((id) => String(id) !== uid) : old.admins,
          memberCount: memberDetails.length,
        };
      });
    });
  }
}

/** Test seam: forget the applied-event memory. */
export function resetMembershipEventMemory() {
  appliedCountChanges.clear();
}

/**
 * The viewer has just joined `result` (the server's join response): the group
 * goes into the conversation list now, not when the list next refetches.
 *
 * Opening a group straight after joining it used to find no row for it, so
 * the chat screen fell back to "not a conversation you can open" and showed
 * the invite again until the refetch landed. The row is built from what the
 * device already has (the invite preview it just showed) and is replaced by
 * the server's own copy on that refetch. A row that is already there (a group
 * left earlier) is marked joined, stamped with the server's join time so a
 * late removal event about the earlier stay cannot undo it.
 */
export function seedJoinedGroup(queryClient, result, preview) {
  const id = result?.publicId || result?.conversationId;
  if (!queryClient || !id) return;
  const keys = [id, result.internalId].filter(Boolean).map(String);
  const matches = (c) => keys.some((k) => matchesConversationId(c, k));
  const stamp = result.membershipChangedAt || null;
  queryClient.setQueryData(['conversations'], (old) => {
    if (!Array.isArray(old)) return old;
    if (old.some(matches)) {
      return old.map((c) => (matches(c) && isCurrentMembership(c, stamp)
        ? { ...c, isMember: true, myMembershipStatus: 'MEMBER', leftAt: null, ...(stamp ? { membershipChangedAt: stamp } : {}) }
        : c));
    }
    const now = new Date().toISOString();
    const avatar = preview?.avatarKey || preview?.avatar || null;
    const members = Number(preview?.memberCount) || 0;
    return [
      {
        id,
        publicId: id,
        internalId: result.internalId || id,
        type: 'GROUP',
        isGroup: true,
        isMember: true,
        myMembershipStatus: 'MEMBER',
        ...(stamp ? { membershipChangedAt: stamp } : {}),
        name: preview?.name || 'Group',
        avatar,
        avatarKey: avatar,
        description: preview?.description || null,
        memberCount: result.alreadyMember ? members : members + 1,
        unreadCount: 0,
        unread: 0,
        lastMessage: null,
        pinned: false,
        muted: false,
        createdAt: now,
        updatedAt: now,
      },
      ...old,
    ];
  });
}
