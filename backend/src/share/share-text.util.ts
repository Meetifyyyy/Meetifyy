/**
 * Text measurement, wrapping and escaping for the OG share card.
 *
 * WHY MEASUREMENT IS APPROXIMATED RATHER THAN MEASURED
 * The card is composed as SVG and rasterised by sharp (librsvg). librsvg lays
 * text out itself and reports nothing back, so there is no way to ask "how wide
 * is this string" before rendering. The alternatives are a headless browser (a
 * new heavyweight dependency, and hundreds of milliseconds per card) or a font
 * parser reading Inter's `hmtx` table (a new dependency, for a number that only
 * has to be right enough to decide where to break a line).
 *
 * So the advance widths below are Inter's, as a fraction of the font size,
 * rounded. The consequence of being a few percent out is a line that breaks one
 * word earlier or later than ideal. The consequence of being badly out would be
 * text running off the canvas, and that is prevented structurally instead: the
 * table errs WIDE (see WIDE_BIAS), every layout has a hard line cap, and the
 * canvas has margin the text is never allowed into.
 */

/**
 * Advance width per character, as a fraction of the font size.
 *
 * MEASURED, NOT GUESSED
 * Every number here was read off real rendered type: each glyph set twenty
 * times in Inter at 700 weight, rasterised through the same sharp/librsvg path
 * the card uses, trimmed, and divided by the repeat count.
 *
 * The table this replaced was written by hand and estimated uppercase at the
 * same width as lowercase. It was out by a third on the widest letters — `Q`
 * measured 0.56 against a true 0.745 — so a poll question in sentence case
 * wrapped a line late and ran off the right edge of the canvas. Anything that
 * cannot be read off the rendering is a guess, and a guess is what put text
 * outside the frame.
 *
 * Bold is deliberately the reference weight: it is the widest the card sets,
 * so a regular-weight line measured against it is over-estimated, which errs
 * in the safe direction. `advanceFor` handles everything outside this table.
 */
const ADVANCE: Record<string, number> = {
  // Space, and the punctuation that carries almost no ink.
  ' ': 0.215,
  '!': 0.243,
  '"': 0.465,
  "'": 0.265,
  ',': 0.241,
  '.': 0.241,
  ':': 0.241,
  ';': 0.244,
  '|': 0.336,

  // Narrow letters and digits.
  i: 0.242,
  j: 0.246,
  l: 0.241,
  t: 0.328,
  f: 0.32,
  r: 0.378,
  I: 0.254,
  '1': 0.387,
  '(': 0.328,
  ')': 0.328,
  '[': 0.327,
  ']': 0.327,
  '{': 0.435,
  '}': 0.435,
  '/': 0.364,
  '\\': 0.289,
  '-': 0.44,

  // The rest of lowercase.
  a: 0.549,
  b: 0.594,
  c: 0.553,
  d: 0.595,
  e: 0.559,
  g: 0.595,
  h: 0.581,
  k: 0.548,
  m: 0.879,
  n: 0.581,
  o: 0.579,
  p: 0.594,
  q: 0.595,
  s: 0.518,
  u: 0.581,
  v: 0.553,
  w: 0.818,
  x: 0.536,
  y: 0.553,
  z: 0.519,

  // Uppercase, which the old table treated as lowercase and badly under-measured.
  A: 0.725,
  B: 0.641,
  C: 0.723,
  D: 0.698,
  E: 0.604,
  F: 0.578,
  G: 0.733,
  H: 0.713,
  J: 0.558,
  K: 0.682,
  L: 0.553,
  M: 0.889,
  N: 0.72,
  O: 0.745,
  P: 0.628,
  Q: 0.745,
  R: 0.647,
  S: 0.65,
  T: 0.634,
  U: 0.699,
  V: 0.723,
  W: 1.013,
  X: 0.697,
  Y: 0.689,
  Z: 0.632,

  // Digits and remaining symbols.
  '0': 0.647,
  '2': 0.595,
  '3': 0.617,
  '4': 0.655,
  '5': 0.598,
  '6': 0.615,
  '7': 0.567,
  '8': 0.611,
  '9': 0.615,
  '#': 0.625,
  $: 0.65,
  '%': 0.932,
  '&': 0.646,
  '*': 0.53,
  '+': 0.647,
  '<': 0.647,
  '=': 0.647,
  '>': 0.647,
  '?': 0.564,
  '@': 1.004,
  '^': 0.461,
  _: 0.475,
  '`': 0.291,
  '~': 0.649,
};

/**
 * Used for every character the table does not name — accented Latin, Cyrillic,
 * Greek, Devanagari and the rest. Set at the wide end of what those scripts
 * measure, because they are the cases this file knows least about.
 */
const DEFAULT_ADVANCE = 0.62;

/**
 * Scripts whose glyphs are about a full em wide rather than about half of one.
 *
 * Without this the table treated a line of Chinese as though it were Latin and
 * under-measured it by nearly half, so the wrap kept twice as many characters
 * as fit and the text ran off the canvas. The ranges cover CJK ideographs and
 * their punctuation, kana, Hangul, and the fullwidth forms — the cases where
 * "one character, one em" is the rule rather than the exception.
 */
const FULL_WIDTH_RANGES: [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // Kana, Bopomofo, Hangul compatibility Jamo, CJK compat
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1faff], // Pictographs and emoji
  [0x20000, 0x3fffd], // CJK Extension B and beyond
];

const FULL_WIDTH_ADVANCE = 1.06;

/**
 * Advance width of one character.
 *
 * Order matters: the explicit table first (it is the accurate part), then the
 * full-width ranges, then the default. Nothing falls through uncounted.
 */
function advanceFor(char: string): number {
  const named = ADVANCE[char];
  if (named !== undefined) return named;

  const code = char.codePointAt(0) ?? 0;
  // Combining marks sit on top of the previous glyph and advance nothing.
  if (code >= 0x0300 && code <= 0x036f) return 0;
  for (const [start, end] of FULL_WIDTH_RANGES) {
    if (code >= start && code <= end) return FULL_WIDTH_ADVANCE;
  }
  return DEFAULT_ADVANCE;
}

/**
 * A deliberate over-estimate applied to every measurement.
 *
 * Breaking a line one word early is invisible. Overrunning the canvas is the
 * defect this whole file exists to prevent, so the bias points that way.
 *
 * Small, because the table beneath it is now measured rather than estimated —
 * this covers letter-spacing and hinting differences between machines, not the
 * table's own error.
 */
const WIDE_BIAS = 1.03;

/** Approximate rendered width of `text` at `fontSize`, in pixels. */
export function measureText(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += advanceFor(char);
  }
  return units * fontSize * WIDE_BIAS;
}

/** Truncates to `maxWidth`, appending an ellipsis when anything was dropped. */
export function truncateToWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
): string {
  if (measureText(text, fontSize) <= maxWidth) return text;
  const ellipsisWidth = measureText('…', fontSize);
  let width = 0;
  let out = '';
  for (const char of text) {
    const next = width + advanceFor(char) * fontSize * WIDE_BIAS;
    if (next + ellipsisWidth > maxWidth) break;
    width = next;
    out += char;
  }
  return `${out.replace(/[\s.,;:!-]+$/u, '')}…`;
}

export interface WrapResult {
  lines: string[];
  /** True when the text did not fit and the last line was ellipsised. */
  truncated: boolean;
}

/**
 * Greedy word wrap with a hard line cap.
 *
 * Post text is user input and can be 2,000 characters of one unbroken word, so
 * two things are load-bearing: a word longer than the line is split rather than
 * allowed to overrun, and `maxLines` is a cap the result can never exceed.
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): WrapResult {
  const source = normaliseWhitespace(text);
  const paragraphs = source.split('\n');
  const lines: string[] = [];

  outer: for (const paragraph of paragraphs) {
    if (paragraph === '') {
      // A blank line is meaningful in a post, but never as the first line of
      // the card — that reads as a rendering bug rather than as spacing.
      if (lines.length > 0 && lines.length < maxLines) lines.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = '';
        if (lines.length >= maxLines) break outer;
      }
      if (measureText(word, fontSize) <= maxWidth) {
        current = word;
        continue;
      }
      // The word alone still does not fit — a URL, or a wall of one repeated
      // character. Break it by character rather than let it leave the canvas.
      let chunk = '';
      for (const char of word) {
        if (measureText(chunk + char, fontSize) > maxWidth) {
          lines.push(chunk);
          chunk = char;
          if (lines.length >= maxLines) break outer;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    if (current) {
      lines.push(current);
      if (lines.length >= maxLines) break outer;
    }
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  // Wrapping only ever removes whitespace, so comparing the non-whitespace
  // characters that made it onto the card against the source is exact: fewer
  // means content was dropped, and nothing else can cause a difference.
  const truncated =
    lines.join('').replace(/\s/g, '').length < source.replace(/\s/g, '').length;

  if (truncated && lines.length) {
    lines[lines.length - 1] = truncateToWidth(
      `${lines[lines.length - 1]} …`,
      fontSize,
      maxWidth,
    );
  }

  return { lines, truncated };
}

/**
 * Collapses runs of whitespace and strips invisible characters.
 *
 * Control and bidi characters are removed rather than escaped: they are
 * invisible in the card, and a bidi override left in place reverses the visual
 * order of the text around it — which on a card carrying an author's name is a
 * spoofing surface, not a cosmetic problem.
 */
export function normaliseWhitespace(text: string): string {
  return (
    String(text ?? '')
      // C0 and C1 control characters. Tab and newline are handled below.
      //
      // `no-control-regex` exists to catch a control character typed into a
      // pattern by accident. Here they are the entire subject: this is the
      // line that stops one reaching an SVG text node, where it is not valid
      // XML in the first place.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      // Zero-width joiners/spaces, bidi embedding, override and isolate marks,
      // and the byte-order mark.
      .replace(
        /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
        '',
      )
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[^\S\n]+/g, ' ')
      .trim()
  );
}

/**
 * Escapes text for an SVG/XML text node or attribute.
 *
 * Every string reaching the renderer is user-controlled — post text, display
 * names, usernames — and the SVG is assembled by string concatenation. Without
 * this, a display name containing `</text><script>` is markup rather than text.
 */
export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncates on a word boundary at a character count, appending an ellipsis.
 *
 * Used for metadata rather than for the card: a meta description is measured in
 * characters by every platform that truncates it, so a pixel measurement would
 * be answering a different question.
 */
export function truncateToChars(text: string, maxChars: number): string {
  const source = String(text ?? '').trim();
  if ([...source].length <= maxChars) return source;

  const clipped = [...source].slice(0, maxChars - 1).join('');
  const lastSpace = clipped.lastIndexOf(' ');
  // Only break at a space when one is reasonably near the end; otherwise a
  // long unbroken token would collapse the whole string to a few characters.
  const body =
    lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.replace(/[\s.,;:!-]+$/u, '')}…`;
}
