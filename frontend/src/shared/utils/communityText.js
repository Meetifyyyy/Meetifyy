/**
 * Whitespace rules for a community description, the same on every surface and
 * the same as the server's (backend/src/common/utils/multiline-text.util.ts):
 *
 *   - Windows/old-Mac line endings become `\n`;
 *   - runs of spaces and tabs (and no-break / ideographic spaces) become one;
 *   - blanks right before or after a line break go;
 *   - at most one empty line between paragraphs;
 *   - leading and trailing whitespace goes.
 *
 * Line and paragraph breaks are kept. The server applies this on save; it is
 * also applied when showing a description, so ones saved before the rule
 * existed read the same way.
 */
export function normalizeMultilineText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    // Zero-width spaces and the BOM carry nothing visible: dropped. (The
    // zero-width JOINER, which emoji sequences need, is not among them.)
    .replace(/[\u200b\u2060\ufeff\u180e]/g, '')
    // Blank-looking "filler" letters (Hangul fillers, the blank Braille cell)
    // are used to fake empty space, which the whitespace rules cannot see:
    // they count as spaces.
    .replace(/[\u115f\u1160\u3164\uffa0\u2800]/g, ' ')
    .replace(/[ \t\f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The description as one paragraph, for a clamped preview (cards, search
 * results): every line break becomes a space, so a blank line never spends
 * one of the preview's few lines on nothing.
 */
export function toSummaryText(value) {
  return normalizeMultilineText(value).replace(/\n+/g, ' ');
}
