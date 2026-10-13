/**
 * Hashtags in user text. Mirrors backend `src/posts/hashtags.util.ts` exactly,
 * so what the server indexes as a hashtag is what renders as a link — change
 * both together.
 *
 * `#` + 2–50 letters (with combining marks), digits or underscores, at least
 * one letter, not glued to a word, URL path or entity ("C#", "a/#b", "&#39;").
 */
const HASHTAG = /(^|[^\p{L}\p{M}\p{N}_&/#])#([\p{L}\p{M}\p{N}_]{2,50})(?![\p{L}\p{M}\p{N}_])/gu;
const HAS_LETTER = /\p{L}/u;

/**
 * Splits text into plain and hashtag pieces, in order:
 * `[{ text }, { text: '#Music', tag: 'music' }, …]`. Joining every `text`
 * gives back the input unchanged.
 */
export function splitHashtags(text) {
  if (!text || typeof text !== 'string' || !text.includes('#')) return [{ text: text || '' }];
  const out = [];
  let cursor = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const [, lead, name] = match;
    if (!HAS_LETTER.test(name)) continue;
    const start = match.index + lead.length;
    if (start > cursor) out.push({ text: text.slice(cursor, start) });
    out.push({ text: `#${name}`, tag: name.toLowerCase() });
    cursor = start + 1 + name.length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out.length > 0 ? out : [{ text }];
}

/** Where a tapped hashtag goes: posts carrying that exact tag. */
export function hashtagSearchPath(tag) {
  return `/search?q=${encodeURIComponent(`#${tag}`)}&type=posts`;
}
