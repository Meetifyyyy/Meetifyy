/**
 * Interest matching for ranked surfaces (currently the Crew For You feed).
 */

/** Interests shorter than this are too ambiguous to match on ("ai", "tv"). */
export const MIN_INTEREST_LENGTH = 3;

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How many of `interests` appear in `text` as the START of a word, capped.
 *
 * A start-of-word match, not a substring one: "art" should find "art walk"
 * and "artists", not "start", "party" or "smart". Plain `includes` matched
 * all of those, so a short interest made almost every activity look relevant.
 */
export function countInterestMatches(
  text: string,
  interests: readonly string[],
  cap: number,
): number {
  const haystack = text.toLowerCase();
  let matches = 0;
  for (const raw of interests) {
    const interest = (raw || '').trim().toLowerCase();
    if (interest.length < MIN_INTEREST_LENGTH) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(interest)}`, 'u');
    if (re.test(haystack)) matches += 1;
    if (matches >= cap) break;
  }
  return matches;
}
