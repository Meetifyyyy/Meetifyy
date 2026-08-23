/**
 * Surgical cache updates for community membership changes.
 *
 * A join or a leave changes three small things: a member count, one row in a
 * member list, and — only for the person it happened to — their own
 * membership flags. Nothing else about the community moves.
 *
 * The previous handling treated it as a reason to reload everything. It
 * invalidated the community list, the campus list, the feed, the post list
 * and the community detail, and it set the detail cache to `null` first.
 * That null is what produced the visible flash: CommunityView derives
 * `isLoading` from `!comm`, so wiping the cache swapped the whole page for a
 * skeleton until the refetch landed.
 *
 * These helpers patch what changed and leave the rendered object otherwise
 * identical, so React re-renders the member count and nothing else.
 */

/** Applies `patch` to a community only if it actually changes something.
 *  Returning the same reference keeps React from re-rendering consumers. */
function applyPatch(community, patch) {
  if (!community) return community;
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (community[k] !== v) { changed = true; break; }
  }
  return changed ? { ...community, ...patch } : community;
}

/** Maps over whichever list shape this cache holds, preserving identity when
 *  no row changed so untouched lists do not re-render. */
function mapCommunities(data, fn) {
  if (!data) return data;

  if (Array.isArray(data)) {
    let changed = false;
    const next = data.map((c) => {
      const updated = fn(c);
      if (updated !== c) changed = true;
      return updated;
    });
    return changed ? next : data;
  }

  if (Array.isArray(data.communities)) {
    const next = mapCommunities(data.communities, fn);
    return next === data.communities ? data : { ...data, communities: next };
  }

  if (Array.isArray(data.pages)) {
    let changed = false;
    const pages = data.pages.map((pg) => {
      const next = mapCommunities(pg, fn);
      if (next !== pg) changed = true;
      return next;
    });
    return changed ? { ...data, pages } : data;
  }

  return data;
}

/**
 * The membership fields a change can touch.
 *
 * `memberCount` comes from the server — it is computed in the same
 * transaction as the membership row, so it is authoritative and never drifts
 * the way a client-side ±1 would after a missed or duplicated event.
 */
export function membershipPatch({ memberCount, isSelf, joined }) {
  const patch = {};
  if (Number.isFinite(memberCount)) patch.memberCount = memberCount;
  if (isSelf) {
    patch.isJoined = joined;
    patch.isMember = joined;
    if (!joined) patch.userRole = null;
    else if (joined) patch.userRole = 'MEMBER';
  }
  return patch;
}

/** Patches every cached list that can contain this community. */
export function patchCommunityInLists(queryClient, communityId, patch) {
  if (!communityId || Object.keys(patch).length === 0) return;
  queryClient.setQueriesData(
    { predicate: (q) => ['communities', 'campus-communities'].includes(q.queryKey[0]) },
    (data) => mapCommunities(data, (c) => (c?.id === communityId ? applyPatch(c, patch) : c)),
  );
}

/**
 * Patches the community detail, including its member list.
 *
 * The member strip is capped server-side (50 rows), so a join is appended
 * only when the strip is not already full — pushing a 51st row would show a
 * member the next refetch removes again.
 */
export function patchCommunityDetail(queryClient, communityId, patch, memberChange) {
  if (!communityId) return;
  queryClient.setQueryData(['community', communityId], (prev) => {
    if (!prev) return prev; // Never conjure a detail we do not have.

    let next = applyPatch(prev, patch);

    if (memberChange && Array.isArray(prev.members)) {
      const { userId, joined, user } = memberChange;
      if (!joined) {
        const members = prev.members.filter(
          (m) => (m?.userId ?? m?.user?.id) !== userId,
        );
        if (members.length !== prev.members.length) {
          next = next === prev ? { ...prev } : next;
          next.members = members;
        }
      } else if (
        prev.members.length < 50 &&
        !prev.members.some((m) => (m?.userId ?? m?.user?.id) === userId)
      ) {
        next = next === prev ? { ...prev } : next;
        next.members = [...prev.members, { userId, role: 'MEMBER', user: user ?? null }];
      }
    }

    return next;
  });
}

/**
 * A role change: one member's badge, and the viewer's own role if it is
 * theirs. Carries no count, so nothing else is touched.
 */
export function patchCommunityMemberRole(queryClient, communityId, memberId, newRole, currentUserId) {
  if (!communityId || !memberId) return;

  queryClient.setQueryData(['community', communityId], (prev) => {
    if (!prev) return prev;
    let next = prev;

    if (Array.isArray(prev.members)) {
      let changed = false;
      const members = prev.members.map((m) => {
        const id = m?.userId ?? m?.user?.id;
        if (id !== memberId || m.role === newRole) return m;
        changed = true;
        return { ...m, role: newRole };
      });
      if (changed) next = { ...prev, members };
    }

    if (currentUserId && currentUserId === memberId && prev.userRole !== newRole) {
      next = next === prev ? { ...prev } : next;
      next.userRole = newRole;
    }

    return next;
  });
}

/**
 * One membership event, applied everywhere it is visible.
 *
 * Deliberately performs no invalidation: nothing is refetched, no query
 * enters a loading state, and the community page stays mounted with its
 * content on screen throughout.
 */
export function applyMembershipEvent(queryClient, {
  communityId, userId, memberCount, joined, currentUserId, user,
}) {
  if (!communityId) return;

  const isSelf = Boolean(currentUserId && userId && currentUserId === userId);
  const patch = membershipPatch({ memberCount, isSelf, joined });

  patchCommunityInLists(queryClient, communityId, patch);
  patchCommunityDetail(queryClient, communityId, patch, userId ? { userId, joined, user } : null);
}
