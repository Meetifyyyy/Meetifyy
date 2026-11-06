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

/**
 * The most line breaks a description may hold (so at most 11 lines).
 *
 * Must match COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS in
 * backend/src/communities/community-limits.ts, which refuses more.
 */
export const COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS = 10;

/**
 * `text` with every line break past the limit turned into a space. Applied as
 * the person types or pastes, so the form can never hold more than the server
 * accepts; Enter past the limit simply does nothing visible.
 */
export function limitLineBreaks(text, max = COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS) {
  if (typeof text !== 'string') return '';
  let seen = 0;
  return text.replace(/\r\n?|\n/g, () => (++seen > max ? ' ' : '\n'));
}
