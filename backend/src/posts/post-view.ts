/**
 * Shaping shared by every path that returns posts to a client: the poll block
 * and the media URL.
 */

/**
 * A poll option as the post read paths receive it: a Prisma row (with or
 * without `_count`) or a row the raw feed query built as JSON.
 */
export interface PollOptionLike {
  id: string;
  text: string;
  /** Int from Prisma; whatever JSON_AGG produced from the raw feed query. */
  voteCount?: unknown;
  _count?: { votes: number };
}

/** The poll block a post carries to the client. */
export interface PollView {
  question: string;
  options: Array<{ id: string; text: string; votes: number }>;
  totalVotes: number;
  userVotedOptionId: string | undefined;
  votedOptionIndex: number | undefined;
  myVotes: number[];
  selectedUsers: Record<string, number[]>;
}

/**
 * Builds a post's poll block. The read paths that use it (posts and search)
 * count votes differently (see each caller), so the count is passed in rather
 * than decided here.
 */
export function buildPollView(
  question: string,
  pollOptions: PollOptionLike[],
  votesOf: (option: PollOptionLike) => number,
  userVotedOptionId: string | null | undefined,
  viewerId: string | undefined,
): PollView {
  const sortedOptions = [...pollOptions].sort((a, b) =>
    (a.id || '').localeCompare(b.id || ''),
  );
  const options = sortedOptions.map((opt) => ({
    id: opt.id,
    text: opt.text,
    votes: votesOf(opt),
  }));
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
  const userVotedIndex = userVotedOptionId
    ? options.findIndex((o) => o.id === userVotedOptionId)
    : -1;
  const myVotes = userVotedIndex >= 0 ? [userVotedIndex] : [];
  const selectedUsers: Record<string, number[]> =
    viewerId && myVotes.length > 0 ? { [viewerId]: myVotes } : {};
  return {
    question,
    options,
    totalVotes,
    userVotedOptionId: userVotedOptionId || undefined,
    votedOptionIndex: userVotedIndex >= 0 ? userVotedIndex : undefined,
    myVotes,
    selectedUsers,
  };
}

/** The media fields the read paths shape into a URL. */
export interface MediaLike {
  objectKey?: string | null;
  /** Never a column; kept because the shaping has always honoured one. */
  url?: string | null;
}

export function withMediaUrl<M extends MediaLike>(m: M) {
  return {
    ...m,
    url: m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null),
  };
}
