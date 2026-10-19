/**
 * Length limits for user-written text. The server half of the pair; mirrored
 * by `frontend/src/shared/utils/textLimit.js`, which must agree with it.
 *
 * Length is counted in Unicode code points, which is how Postgres counts the
 * VARCHAR columns the text is stored in. An emoji is one character, as are an
 * accented letter and a line break. (`String.length` would count an emoji as
 * two; class-validator's `@MaxLength` skips variation selectors, so it would
 * pass text the column then rejects.) The text is stored exactly as sent, so
 * whitespace counts.
 */

/** Longest a comment or reply may be, in characters. Equals `Comment.text`. */
export const COMMENT_MAX_CHARS = 500;

/** Longest a post's text may be, in characters. Equals `Post.text`. */
export const POST_MAX_CHARS = 2000;

/** Number of characters in `text` as Postgres counts them (code points). */
export function countChars(text: string): number {
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
