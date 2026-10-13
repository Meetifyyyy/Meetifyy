/**
 * The non-SQL half of the For You feed: arranging scored candidates into the
 * order the viewer scrolls through, and the cursor format that walks it.
 *
 * `PostsService.getRankedFeed` scores a bounded window of recent posts in one
 * query; this file decides the final order. Pure, so it is tested without a
 * database.
 */

/** One scored candidate out of the ranking query. */
export interface RankedCandidate {
  id: string;
  authorId: string;
  createdAt: Date;
  score: number;
  /** The viewer follows the author. */
  followsAuthor: boolean;
  /** The viewer wrote it. */
  isOwn: boolean;
}

/** Posts this fresh from someone the viewer follows (or from the viewer)
 *  go to the top in time order, whatever they score. A ranked feed that hides
 *  a friend's post from ten minutes ago reads as broken, not personalised. */
export const FRESH_PIN_MS = 60 * 60 * 1000;

/** No author more than this many times in any `DIVERSITY_WINDOW` run. */
export const MAX_PER_AUTHOR = 2;
export const DIVERSITY_WINDOW = 10;

export function arrangeRankedFeed(
  candidates: readonly RankedCandidate[],
  now: number = Date.now(),
): string[] {
  const pinned: RankedCandidate[] = [];
  const rest: RankedCandidate[] = [];
  for (const c of candidates) {
    const fresh = now - c.createdAt.getTime() < FRESH_PIN_MS;
    if (fresh && (c.followsAuthor || c.isOwn)) pinned.push(c);
    else rest.push(c);
  }
  pinned.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  rest.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  // Pinned posts are exempt from the diversity rule: they are there because
  // they are new, and deferring one would defeat the pin.
  const out: RankedCandidate[] = [...pinned];
  const queue = [...rest];
  while (queue.length > 0) {
    const recent = out.slice(-DIVERSITY_WINDOW);
    const idx = queue.findIndex(
      (c) =>
        recent.filter((r) => r.authorId === c.authorId).length < MAX_PER_AUTHOR,
    );
    // Nothing fits (one prolific author left at the end): take the best
    // remaining rather than dropping posts.
    const [next] = queue.splice(idx === -1 ? 0 : idx, 1);
    out.push(next);
  }
  return out.map((c) => c.id);
}

/**
 * Ranked cursors are `r1.<sessionId>.<offset>`: a position in an ordered id
 * list cached for the session. Scores move as posts age, so a keyset cursor on
 * (score, id) would skip and repeat posts between pages; a frozen list cannot.
 *
 * Anything else is a chronological cursor, which is how the feed continues
 * past the ranked window and how a cursor from an older client still works.
 */
const RANKED_CURSOR = /^r1\.([0-9a-f-]{36})\.(\d{1,5})$/;

export function parseRankedCursor(
  cursor: string | undefined,
): { sessionId: string; offset: number } | null {
  if (!cursor) return null;
  const m = RANKED_CURSOR.exec(cursor);
  return m ? { sessionId: m[1], offset: Number(m[2]) } : null;
}

export function rankedCursor(sessionId: string, offset: number): string {
  return `r1.${sessionId}.${offset}`;
}
