/**
 * The longest community description the server accepts, in characters.
 *
 * Must match COMMUNITY_DESCRIPTION_MAX in
 * frontend/src/shared/constants/communityLimits.js. The column is unbounded
 * text, so this validation is the only enforcement.
 */
export const COMMUNITY_DESCRIPTION_MAX = 250;

/**
 * The most line breaks a community description may hold (so at most 11
 * lines). Counted after whitespace normalisation, so trailing or stacked
 * blank lines do not count against it.
 *
 * Must match COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS in
 * frontend/src/shared/constants/communityLimits.js.
 */
export const COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS = 10;

/** Line breaks in `text`. */
export const countLineBreaks = (text: string): number =>
  (text.match(/\n/g) ?? []).length;

/**
 * `text` with every line break past the limit turned into a space, for
 * descriptions saved before the limit existed.
 */
export function capLineBreaks(
  text: string,
  max = COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS,
): string {
  let seen = 0;
  return text.replace(/\n/g, () => (++seen > max ? ' ' : '\n'));
}
