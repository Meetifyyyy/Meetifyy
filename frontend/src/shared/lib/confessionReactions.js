/**
 * The five reactions a confession can get, and the arithmetic the client does
 * with them. Pure: no React, no network.
 *
 * The keys are the wire values (`PUT /api/confessions/:id/reaction`); the
 * order is the picker's.
 */
export const CONFESSION_REACTIONS = [
  { key: 'love', emoji: '❤️', label: 'Love' },
  { key: 'funny', emoji: '😂', label: 'Funny' },
  { key: 'sad', emoji: '😢', label: 'Sad' },
  { key: 'surprised', emoji: '😮', label: 'Surprised' },
  { key: 'relatable', emoji: '🤝', label: 'Relatable' },
];

export const REACTION_BY_KEY = Object.fromEntries(CONFESSION_REACTIONS.map((r) => [r.key, r]));

const isKey = (value) => typeof value === 'string' && Object.hasOwn(REACTION_BY_KEY, value);

const emptyCounts = () => Object.fromEntries(CONFESSION_REACTIONS.map((r) => [r.key, 0]));

/**
 * A confession's reaction fields in one shape, whatever the server sent.
 *
 * A server from before reactions sends only `relateCount`/`relatedByMe`; that
 * is read as Relatable, which is what those relates now are.
 */
export function reactionStateOf(confession) {
  const c = confession || {};
  const counts = emptyCounts();
  if (c.reactions && typeof c.reactions === 'object') {
    for (const r of CONFESSION_REACTIONS) {
      const n = Number(c.reactions[r.key]);
      counts[r.key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
  } else {
    counts.relatable = Math.max(0, Number(c.relateCount) || 0);
  }
  const mine = isKey(c.myReaction) ? c.myReaction : (!('myReaction' in c) && c.relatedByMe ? 'relatable' : null);
  // Never show your own reaction against a count of zero.
  if (mine && counts[mine] === 0) counts[mine] = 1;
  const total = CONFESSION_REACTIONS.reduce((sum, r) => sum + counts[r.key], 0);
  return { reactions: counts, reactionCount: total, myReaction: mine, relateCount: total, relatedByMe: mine !== null };
}

/**
 * The state after the caller picks `next` (a key, or null to remove theirs):
 * their old kind loses one, the new kind gains one, the total moves only when
 * they go from none to some or back.
 */
export function withReaction(confession, next) {
  const state = reactionStateOf(confession);
  const target = isKey(next) ? next : null;
  if (state.myReaction === target) return state;
  const counts = { ...state.reactions };
  if (state.myReaction) counts[state.myReaction] = Math.max(0, counts[state.myReaction] - 1);
  if (target) counts[target] += 1;
  const total = CONFESSION_REACTIONS.reduce((sum, r) => sum + counts[r.key], 0);
  return { reactions: counts, reactionCount: total, myReaction: target, relateCount: total, relatedByMe: target !== null };
}

/** The kinds that have any reactions, most first (picker order breaks ties). */
export function topReactions(state, limit = 3) {
  return CONFESSION_REACTIONS
    .filter((r) => state.reactions[r.key] > 0)
    .sort((a, b) => state.reactions[b.key] - state.reactions[a.key])
    .slice(0, limit);
}

/** "12 reactions: 7 Love, 5 Funny" — for screen readers and tooltips. */
export function describeReactions(state) {
  if (!state.reactionCount) return 'No reactions yet';
  const parts = topReactions(state, CONFESSION_REACTIONS.length).map((r) => `${state.reactions[r.key]} ${r.label}`);
  const noun = state.reactionCount === 1 ? 'reaction' : 'reactions';
  return `${state.reactionCount} ${noun}: ${parts.join(', ')}`;
}

/** 999 → "999", 1200 → "1.2K". */
export function formatCount(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.floor(k) : Math.floor(k * 10) / 10}K`;
}
