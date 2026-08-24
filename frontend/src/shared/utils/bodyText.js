/**
 * Shared handling for user-authored body text — posts and comments.
 *
 * Two jobs, both of which existed only inside Post before this: tidy the
 * whitespace people actually type, and clip an over-long body behind a
 * "See more" toggle so one author cannot push everything else off the screen.
 *
 * It lived as a copy-pasted `normalizePostText` in Post.jsx and again in
 * PostComposer.jsx, and comments had neither — so a comment with twenty blank
 * lines rendered all twenty, and a thousand-character comment rendered in
 * full, indented, inside a thread of ordinary one-liners.
 */

/** Post/comment body limits. Comments are tighter — see COMMENT_LIMITS. */
export const POST_LIMITS = { maxChars: 300, maxLines: 8 };

/**
 * Comments sit indented inside a thread, several to a screen, so they get
 * less room before clipping than a top-level post does. The shape of the
 * behaviour is identical; only the thresholds differ.
 */
export const COMMENT_LIMITS = { maxChars: 220, maxLines: 5 };

/**
 * Collapse the whitespace people type but rarely mean.
 *
 * Leading/trailing space goes, CRLF is normalised, and a run of three or more
 * newlines becomes one blank line — enough to keep a deliberate paragraph
 * break while refusing to render a screen of emptiness someone left by
 * holding Enter.
 */
export function normalizeBodyText(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Clip normalized text to whichever limit it hits first.
 *
 * Both limits matter and neither implies the other: 300 characters on one
 * line is a wall of text, and 20 short lines is a wall of a different shape.
 *
 * @param {string} normalized text already through normalizeBodyText
 * @returns {{ text: string, needsTruncation: boolean }}
 */
export function truncateBodyText(normalized, { maxChars, maxLines } = POST_LIMITS) {
  const full = normalized || '';
  const exceedsChars = full.length > maxChars;
  const exceedsLines = full.split('\n').length > maxLines;

  if (!exceedsChars && !exceedsLines) {
    return { text: full, needsTruncation: false };
  }

  const byChars = exceedsChars ? full.slice(0, maxChars) : full;
  const lines = byChars.split('\n');
  let clipped = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : byChars;

  // Only mark an ellipsis when something was actually removed — a body that
  // tripped the line check but ends exactly on the boundary has nothing after
  // it, and "…" would promise more text than exists.
  if (clipped.length < full.length) clipped = `${clipped.trimEnd()}...`;

  return { text: clipped, needsTruncation: true };
}

/**
 * Drop mentions that fall outside the visible slice.
 *
 * RichText positions structured mentions by absolute index, so a mention
 * whose range runs past the clipped text would either be skipped or slice
 * into the ellipsis. Only mentions that end within the real (pre-ellipsis)
 * text survive; the rest come back when the body is expanded.
 */
export function clipMentions(mentions, displayedText) {
  const shown = displayedText || '';
  const limit = shown.endsWith('...') ? shown.length - 3 : shown.length;
  return (mentions || []).filter((m) => typeof m?.end === 'number' && m.end <= limit);
}
