/**
 * The longest community description the server accepts, in characters.
 *
 * Must match COMMUNITY_DESCRIPTION_MAX in
 * frontend/src/shared/constants/communityLimits.js. The column is unbounded
 * text, so this validation is the only enforcement.
 */
export const COMMUNITY_DESCRIPTION_MAX = 250;
