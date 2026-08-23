import { getMediaUrl } from '@shared/api/apiClient';

/**
 * Membership predicates for a community payload.
 *
 * The API answers with `isJoined` and `userRole` (`'OWNER' | 'MODERATOR' |
 * 'MEMBER' | null`), but different surfaces had each invented their own guess at
 * the field name — `comm.joined`, `comm.isMember`, a scan of
 * `currentUser.communities` — and disagreed as a result. The profile sidebar's
 * guess (`comm.joined`) matched nothing the API has ever returned, so its button
 * read "Join" for communities the viewer had already joined, or owned.
 *
 * One reading, so every card, list and header shows the same state.
 */

/** The owner of a community. Always also a member. */
export function isCommunityOwner(community, currentUser) {
  if (!community || !currentUser?.id) return false;
  if (community.userRole === 'OWNER') return true;
  return Boolean(community.ownerId && String(community.ownerId) === String(currentUser.id));
}

/** Anyone with a role in the community, the owner included. */
export function isCommunityMember(community, currentUser) {
  if (!community) return false;
  if (isCommunityOwner(community, currentUser)) return true;

  // `isJoined` is the canonical field; `isMember` is accepted because the
  // optimistic updater writes both.
  if (community.isJoined === true || community.isMember === true) return true;
  if (['OWNER', 'MODERATOR', 'MEMBER'].includes(community.userRole)) return true;

  // Some payloads inline the member list instead of a flag.
  if (currentUser?.id && Array.isArray(community.members)) {
    return community.members.some(
      (m) => String(m?.userId || m?.id || m?.user?.id) === String(currentUser.id),
    );
  }

  return false;
}

/**
 * Whether the viewer is allowed to leave.
 *
 * The owner is not: the server rejects it with "Community owner cannot leave
 * without transferring ownership", so offering the action only produced a
 * request that was always going to 403 and an optimistic toggle that snapped
 * back. They have to transfer ownership or delete the community.
 */
export function canLeaveCommunity(community, currentUser) {
  return isCommunityMember(community, currentUser) && !isCommunityOwner(community, currentUser);
}

/** Member count, across the several names the payloads use for it. */
export function communityMemberCount(community) {
  if (!community) return 0;
  const raw = community.memberCount ?? community.membersCount
    ?? (Array.isArray(community.members) ? community.members.length : 0);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolve a community's cover image to a loadable URL, or null.
 *
 * The same shape of bug as the avatar: the column is `coverKey`, several
 * surfaces read `coverImage`, and the stored value is an object key that has to
 * go through `getMediaUrl` before it can be an `<img src>`.
 */
export function resolveCommunityCover(community) {
  const raw = community?.coverKey || community?.coverImage || community?.cover;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length <= 2) return null;
  // A CSS gradient is a valid cover in this app and is not an image URL.
  if (trimmed.startsWith('linear-gradient') || trimmed.startsWith('radial-gradient') || trimmed.startsWith('conic-gradient')) return null;
  return getMediaUrl(trimmed);
}
