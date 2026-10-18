import { Prisma } from '@prisma/client';

/**
 * Ranking shared by the two "pick a person" surfaces: the share/invite
 * recipient list (`getConnections`) and @mention suggestions.
 *
 * A picker is not discovery. The viewer is reaching for someone they already
 * have in mind, so:
 *
 *   - With a query, how well the name matches decides first (exact, then
 *     starts-with — including any word of the display name — then contains),
 *     and the viewer's relationship to the person orders within that.
 *   - With no query, the list is the viewer's own people: whom they talk to
 *     most recently, then mutual follows, then one-way follows, then campus.
 *
 * Candidate fetching is split the same way, because both pickers used to take
 * the newest N accounts that merely CONTAINED the query and rank only those —
 * so an exact @username could be missing whenever N newer accounts also
 * contained the text, and the empty-query share list was strangers who had
 * just signed up.
 */

export interface PickerSocial {
  /** User id → position in the viewer's recent conversations (0 = latest). */
  recentChat: Map<string, number>;
  following: Set<string>;
  followers: Set<string>;
  /** The viewer's ACTIVE affiliation college (campus access), or null. */
  collegeId: string | null;
}

export type MatchTier = 3 | 2 | 1 | 0;

/** 3 exact, 2 starts-with (username, display name, or a word in it),
 *  1 contains, 0 no query. */
export function matchTier(
  user: { username: string; displayName: string | null },
  query: string,
): MatchTier {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const uname = user.username.toLowerCase();
  const dname = (user.displayName || '').toLowerCase();
  if (uname === q || dname === q) return 3;
  if (
    uname.startsWith(q) ||
    dname.startsWith(q) ||
    dname.split(/\s+/).some((w) => w.startsWith(q))
  ) {
    return 2;
  }
  return 1;
}

/**
 * How close the viewer is to `userId`, 0..~100. Recency of conversation
 * dominates: whom you messaged yesterday is who you are most likely sharing
 * with today.
 */
export function socialScore(userId: string, s: PickerSocial): number {
  let score = 0;
  const rank = s.recentChat.get(userId);
  if (rank !== undefined) score += 60 - Math.min(rank, 30);
  const following = s.following.has(userId);
  const follower = s.followers.has(userId);
  if (following && follower) score += 25;
  else if (following) score += 15;
  else if (follower) score += 8;
  return score;
}

/**
 * Sorts picker candidates: match tier, then closeness, then campus, then name.
 *
 * `campusPeers` is the subset of candidate ids holding an active affiliation
 * to the viewer's college (one batched lookup by the caller). The
 * `User.collegeId` mirror is not consulted: a legacy row the backfill skipped
 * keeps it without being a verified member of that campus.
 */
export function rankPickerCandidates<
  T extends {
    id: string;
    username: string;
    displayName: string | null;
  },
>(
  candidates: readonly T[],
  query: string,
  social: PickerSocial,
  campusPeers: ReadonlySet<string> = new Set(),
): T[] {
  const keyed = candidates.map((u) => ({
    u,
    tier: matchTier(u, query),
    close: socialScore(u.id, social) + (campusPeers.has(u.id) ? 5 : 0),
  }));
  keyed.sort(
    (a, b) =>
      b.tier - a.tier ||
      b.close - a.close ||
      (a.u.displayName || a.u.username).localeCompare(
        b.u.displayName || b.u.username,
      ),
  );
  return keyed.map((k) => k.u);
}

/** The ids the viewer is closest to, best first, for the no-query list. */
export function closestIds(social: PickerSocial, cap: number): string[] {
  const ids = new Set<string>(
    [...social.recentChat.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id),
  );
  for (const id of social.following) if (social.followers.has(id)) ids.add(id);
  for (const id of social.following) ids.add(id);
  for (const id of social.followers) ids.add(id);
  return [...ids].slice(0, cap);
}

/** `where` for names that START with the query (or have a word that does). */
export function startsWithWhere(query: string): Prisma.UserWhereInput {
  const q = query.trim();
  return {
    OR: [
      { username: { startsWith: q, mode: 'insensitive' } },
      { displayName: { startsWith: q, mode: 'insensitive' } },
      { displayName: { contains: ` ${q}`, mode: 'insensitive' } },
    ],
  };
}
