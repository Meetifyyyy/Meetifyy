/**
 * Whitespace rules for free text people write over several lines (a
 * community description), applied on save so every surface reads the same
 * stored text.
 *
 *   - Windows/old-Mac line endings become `\n`;
 *   - runs of spaces and tabs (and other horizontal blanks: no-break and
 *     ideographic spaces, and blank filler letters such as U+3164) become
 *     one space; zero-width spaces go;
 *   - blanks right before or after a line break go;
 *   - at most one empty line between paragraphs;
 *   - leading and trailing whitespace goes.
 *
 * Line and paragraph breaks are kept: they are the only formatting the text
 * has. Zero-width joiners are left alone, since emoji sequences need them.
 *
 * Must match frontend/src/shared/utils/communityText.js `normalizeMultilineText`.
 */
export function normalizeMultilineText(value: string): string {
  return (
    value
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
      .trim()
  );
}

/** For `@Transform`: normalises strings and passes anything else through to validation. */
export const normalizeMultilineTransform = ({
  value,
}: {
  value: unknown;
}): unknown =>
  typeof value === 'string' ? normalizeMultilineText(value) : value;
