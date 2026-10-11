/**
 * The longest community description, in characters.
 *
 * Must match COMMUNITY_DESCRIPTION_MAX in
 * backend/src/communities/community-limits.ts. The server enforces it; this is
 * so the create and edit forms stop at the same number the counter shows.
 */
export const COMMUNITY_DESCRIPTION_MAX = 250;
export const COMMUNITY_DESCRIPTION_MIN = 3;

/** Whether a (trimmed) description is acceptable when creating a community. */
export function isValidCommunityDescription(text) {
  const length = (text ?? '').trim().length;
  return length >= COMMUNITY_DESCRIPTION_MIN && length <= COMMUNITY_DESCRIPTION_MAX;
}
