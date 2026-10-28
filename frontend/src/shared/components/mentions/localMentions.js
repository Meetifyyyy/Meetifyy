/**
 * Mention suggestions from a list already in memory — a group's members —
 * for the group chat composer. Filtering a few dozen names takes well under a
 * millisecond, so the list follows every keystroke with no request, debounce
 * or loading state (the search-based picker that posts and comments use waits
 * on the network for each term).
 *
 * `@everyone` leads the list whenever what was typed is the start of it.
 * Matches on the start of a name or handle come before matches inside one.
 */
export const EVERYONE_MENTION = Object.freeze({
  id: 'everyone',
  username: 'everyone',
  displayName: 'Everyone',
  isEveryone: true,
});

const MAX_RESULTS = 15;

export function filterLocalMentions(candidates, query, { includeEveryone = true } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const scored = [];
  for (const c of candidates || []) {
    if (!c || !c.username) continue;
    const name = String(c.displayName || '').toLowerCase();
    const handle = String(c.username).toLowerCase();
    let rank;
    if (!q) rank = 2;
    else if (handle.startsWith(q) || name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) rank = 0;
    else if (handle.includes(q) || name.includes(q)) rank = 1;
    else continue;
    scored.push({ c, rank, key: name || handle });
  }
  scored.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  const people = scored.map((s) => s.c);
  const everyone = includeEveryone && EVERYONE_MENTION.username.startsWith(q) ? [EVERYONE_MENTION] : [];
  return [...everyone, ...people].slice(0, MAX_RESULTS);
}
