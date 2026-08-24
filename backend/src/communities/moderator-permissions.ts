/**
 * What a community moderator may actually do.
 *
 * This is the single source of truth for two things that must never disagree:
 * the permissions the code ENFORCES, and the permissions we SHOW people — in
 * the owner's confirmation modal before a promotion, and in the new
 * moderator's welcome modal after one.
 *
 * The temptation is to write a nice list for the UI and leave enforcement
 * scattered across the services. Then someone adds or removes a capability,
 * the list silently becomes a lie, and the person we lied to is the one being
 * handed the power. So the enforcement sites ask `roleCan(...)` against this
 * table rather than testing `role === 'MODERATOR'` inline, and the API serves
 * the display list from the same table. Change a capability here and both the
 * behaviour and the copy move together.
 *
 * Capabilities are deliberately only those that exist and are enforced today.
 * Anything aspirational — muting, banning, pinning, a report queue — is absent
 * because the app does not implement it, and promising it to a new moderator
 * would be a lie told at the exact moment they are deciding what they have
 * signed up for.
 */

export type CommunityRoleName = 'OWNER' | 'MODERATOR' | 'MEMBER';

export type ModeratorCapability =
  | 'DELETE_MEMBER_CONTENT'
  | 'REVIEW_JOIN_REQUESTS'
  | 'REMOVE_MEMBERS';

interface CapabilityDefinition {
  id: ModeratorCapability;
  /** Roles that hold this capability. Order is not significant. */
  roles: CommunityRoleName[];
  /** Shown as the bullet's heading. */
  label: string;
  /** One sentence, plain language, in second person. */
  description: string;
  /**
   * The boundary of the capability, where one exists. These are not caveats
   * for the lawyers — they are the difference between a moderator thinking
   * they can remove anyone and discovering they cannot.
   */
  limit?: string;
}

export const COMMUNITY_CAPABILITIES: Record<ModeratorCapability, CapabilityDefinition> = {
  DELETE_MEMBER_CONTENT: {
    id: 'DELETE_MEMBER_CONTENT',
    roles: ['OWNER', 'MODERATOR'],
    label: 'Remove posts and comments',
    description: "Delete posts and comments left by members of this community.",
    limit: "Not the owner's, and not other moderators'.",
  },
  REVIEW_JOIN_REQUESTS: {
    id: 'REVIEW_JOIN_REQUESTS',
    roles: ['OWNER', 'MODERATOR'],
    label: 'Review join requests',
    description: 'See who has asked to join, and accept or decline them.',
  },
  REMOVE_MEMBERS: {
    id: 'REMOVE_MEMBERS',
    roles: ['OWNER', 'MODERATOR'],
    label: 'Remove members',
    description: 'Remove a member from this community.',
    limit: 'Not the owner, and not other moderators.',
  },
};

/** Does this role hold this capability? The enforcement sites call this. */
export function roleCan(
  role: CommunityRoleName | null | undefined,
  capability: ModeratorCapability,
): boolean {
  if (!role) return false;
  return COMMUNITY_CAPABILITIES[capability].roles.includes(role);
}

/**
 * The display list for a given role, derived from the same table the code
 * enforces with. This is what the promotion modals render.
 */
export function permissionsForRole(role: CommunityRoleName) {
  return Object.values(COMMUNITY_CAPABILITIES)
    .filter((c) => c.roles.includes(role))
    .map(({ id, label, description, limit }) => ({ id, label, description, limit: limit ?? null }));
}

/** Everything a moderator gets. The list both promotion modals show. */
export function moderatorPermissions() {
  return permissionsForRole('MODERATOR');
}
