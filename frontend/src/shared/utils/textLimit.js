/**
 * Length limits for user-written text. The client half of the pair; mirrors
 * `backend/src/common/validation/text-length.util.ts`, which is the
 * enforcement. This only stops a person at the composer with the count in
 * front of them.
 *
 * Length is counted in Unicode code points, as Postgres counts the VARCHAR
 * columns the text is stored in: an emoji is one character, and spaces and
 * line breaks count because they are stored.
 */

/** Longest a comment or reply may be, in characters (`Comment.text`). */
export const COMMENT_MAX_CHARS = 500;
/** The comment counter appears from here. */
export const COMMENT_WARN_AT_CHARS = 400;

/** Longest a post's text may be, in characters (`Post.text`). */
export const POST_MAX_CHARS = 2000;
/** The post counter appears from here. */
export const POST_WARN_AT_CHARS = 1800;

/** Number of characters in `text` as the server counts them (code points). */
export function countChars(text) {
  if (typeof text !== 'string') return 0;
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    // A high surrogate followed by a low one is a single code point.
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

/**
 * Where a draft stands against a limit. `status` is 'ok' (counter hidden),
 * 'near' (counter shown) or 'over' (the draft cannot be sent).
 */
export function getLimitState(text, { max, warnAt }) {
  const value = typeof text === 'string' ? text : '';
  const chars = countChars(value);
  const overBy = Math.max(0, chars - max);
  let status = 'ok';
  if (overBy > 0) status = 'over';
  else if (chars >= warnAt) status = 'near';
  return {
    chars,
    max,
    remaining: max - chars,
    overBy,
    status,
    isOver: status === 'over',
    isEmpty: value.trim().length === 0,
  };
}

/** A comment or reply draft, counted as typed (the server stores it as sent). */
export function getCommentLimitState(text) {
  return getLimitState(text, { max: COMMENT_MAX_CHARS, warnAt: COMMENT_WARN_AT_CHARS });
}

/**
 * A post draft. Pass the text as it will be SENT (after normalizeBodyText),
 * since that is what the server counts.
 */
export function getPostLimitState(text) {
  return getLimitState(text, { max: POST_MAX_CHARS, warnAt: POST_WARN_AT_CHARS });
}
