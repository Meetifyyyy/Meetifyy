/**
 * Reading a post's poll, the same way everywhere it is drawn (the post card,
 * chat previews of a shared post) and everywhere it changes (a vote, a live
 * update).
 *
 * The server sends `options: [{ id, text, votes }]` in the author's order,
 * `totalVotes`, and the viewer's own vote as `userVotedOptionId` (with
 * `votedOptionIndex` / `myVotes` / `selectedUsers` beside it for older
 * clients). Older payloads may carry `voteCount` or bare strings instead.
 */

/** An option's text, whatever shape it came in. */
export function pollOptionText(option) {
  if (option == null) return '';
  if (typeof option === 'string') return option;
  if (typeof option === 'number') return String(option);
  if (typeof option === 'object') {
    for (const key of ['text', 'label', 'title']) {
      if (typeof option[key] === 'string') return option[key];
    }
  }
  return '';
}

/** An option's vote count. */
export function pollOptionVotes(option) {
  if (!option || typeof option !== 'object') return 0;
  const n = Number(option.votes ?? option.voteCount ?? option._count?.votes ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Where the viewer's vote is in `poll.options`, or -1. The option id wins:
 * it names the option itself, while an index only names a place.
 */
export function votedOptionIndex(poll, viewerId) {
  if (!poll) return -1;
  const options = Array.isArray(poll.options) ? poll.options : [];
  if (poll.userVotedOptionId) {
    const byId = options.findIndex((o) => o && typeof o === 'object' && o.id === poll.userVotedOptionId);
    if (byId >= 0) return byId;
  }
  const mine = (viewerId && poll.selectedUsers?.[viewerId]) || poll.myVotes;
  if (Array.isArray(mine) && Number.isInteger(mine[0]) && mine[0] >= 0 && mine[0] < options.length) return mine[0];
  const idx = poll.votedOptionIndex;
  return Number.isInteger(idx) && idx >= 0 && idx < options.length ? idx : -1;
}

export function hasVotedIn(poll, viewerId) {
  return votedOptionIndex(poll, viewerId) >= 0;
}

/**
 * Whole-number percentages that add up to exactly 100 (largest remainder):
 * three equal options read 34/33/33, not 33/33/33. All zero with no votes.
 */
export function pollPercentages(votes) {
  const counts = votes.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, r: x - floors[i] }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * A live update's counts merged into the viewer's poll: each option's votes
 * (matched by id) and the total. Nothing else is taken from it. The update
 * goes to everyone looking at the post, so anything about one viewer's vote
 * in it (older servers sent the voter's) is someone else's, never ours.
 */
export function mergePollCounts(poll, update) {
  if (!poll || !update || typeof update !== 'object') return poll;
  const incoming = Array.isArray(update.options) ? update.options : [];
  const votesById = new Map(
    incoming.filter((o) => o && typeof o === 'object' && o.id).map((o) => [o.id, pollOptionVotes(o)]),
  );
  const options = (Array.isArray(poll.options) ? poll.options : []).map((o) =>
    o && typeof o === 'object' && votesById.has(o.id) ? { ...o, votes: votesById.get(o.id) } : o,
  );
  const total = Number(update.totalVotes);
  return {
    ...poll,
    options,
    totalVotes: Number.isFinite(total) ? total : poll.totalVotes,
  };
}
