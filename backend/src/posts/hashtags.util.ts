/**
 * Hashtag extraction. The frontend mirrors this rule exactly in
 * `frontend/src/shared/utils/hashtags.js`, so what is saved as a hashtag is
 * exactly what renders as one — change both together.
 *
 * A hashtag is `#` followed by 2–50 letters (with their combining marks, so
 * Devanagari and other scripts work), digits or underscores, containing
 * at least one letter (so "#1" and "#2026" stay plain text), and not glued to
 * the end of a word, a URL path or an HTML entity ("C#", "a/#b", "&#39;").
 * Names are stored lower-case, so #Music and #music are one tag.
 */
const HASHTAG =
  /(^|[^\p{L}\p{M}\p{N}_&/#])#([\p{L}\p{M}\p{N}_]{2,50})(?![\p{L}\p{M}\p{N}_])/gu;
const HAS_LETTER = /\p{L}/u;

/** Most tags kept per post; a post that is a wall of tags is not ten topics. */
export const MAX_HASHTAGS_PER_POST = 10;

export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(HASHTAG)) {
    const name = match[2].toLowerCase();
    if (!HAS_LETTER.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_HASHTAGS_PER_POST) break;
  }
  return out;
}

/** A search query that names one hashtag ("#music"), or null. */
export function hashtagQuery(query: string): string | null {
  const tags = extractHashtags(query.trim());
  return query.trim().startsWith('#') && tags.length === 1 ? tags[0] : null;
}
