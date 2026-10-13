import {
  RankedCandidate,
  arrangeRankedFeed,
  parseRankedCursor,
  rankedCursor,
} from './feed-ranking';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

function post(
  id: string,
  over: Partial<RankedCandidate> = {},
): RankedCandidate {
  return {
    id,
    authorId: `author-${id}`,
    createdAt: minutesAgo(600),
    score: 1,
    followsAuthor: false,
    isOwn: false,
    ...over,
  };
}

describe('arrangeRankedFeed', () => {
  it('orders by score', () => {
    const ids = arrangeRankedFeed(
      [
        post('a', { score: 1 }),
        post('b', { score: 5 }),
        post('c', { score: 3 }),
      ],
      NOW,
    );
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('pins fresh posts from followed authors above everything, newest first', () => {
    const ids = arrangeRankedFeed(
      [
        post('viral', { score: 100 }),
        post('friend-old', { followsAuthor: true, createdAt: minutesAgo(30) }),
        post('friend-new', { followsAuthor: true, createdAt: minutesAgo(5) }),
      ],
      NOW,
    );
    expect(ids).toEqual(['friend-new', 'friend-old', 'viral']);
  });

  it('pins the viewer’s own fresh post', () => {
    const ids = arrangeRankedFeed(
      [
        post('top', { score: 50 }),
        post('mine', { isOwn: true, createdAt: minutesAgo(2) }),
      ],
      NOW,
    );
    expect(ids[0]).toBe('mine');
  });

  it('does not pin a followed author’s post once it is over an hour old', () => {
    const ids = arrangeRankedFeed(
      [
        post('top', { score: 50 }),
        post('friend', {
          followsAuthor: true,
          createdAt: minutesAgo(90),
          score: 2,
        }),
      ],
      NOW,
    );
    expect(ids).toEqual(['top', 'friend']);
  });

  it('does not pin a fresh post from a stranger', () => {
    const ids = arrangeRankedFeed(
      [
        post('top', { score: 50 }),
        post('stranger', { createdAt: minutesAgo(1) }),
      ],
      NOW,
    );
    expect(ids).toEqual(['top', 'stranger']);
  });

  it('allows at most two posts per author in any ten-post run', () => {
    const prolific = Array.from({ length: 5 }, (_, i) =>
      post(`p${i}`, { authorId: 'busy', score: 100 - i }),
    );
    const others = Array.from({ length: 10 }, (_, i) =>
      post(`o${i}`, { score: 10 - i / 10 }),
    );
    const ids = arrangeRankedFeed([...prolific, ...others], NOW);
    const firstTen = ids.slice(0, 10);
    expect(firstTen.filter((id) => id.startsWith('p'))).toHaveLength(2);
    // Deferred, not dropped.
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
  });

  it('keeps every post when one author is all that is left', () => {
    const ids = arrangeRankedFeed(
      Array.from({ length: 4 }, (_, i) => post(`p${i}`, { authorId: 'solo' })),
      NOW,
    );
    expect(ids).toHaveLength(4);
  });
});

describe('ranked cursors', () => {
  const sid = '0b0e6f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

  it('round-trips', () => {
    expect(parseRankedCursor(rankedCursor(sid, 40))).toEqual({
      sessionId: sid,
      offset: 40,
    });
  });

  it('treats chronological and malformed cursors as not ranked', () => {
    expect(parseRankedCursor('2026-10-13T10:00:00.000Z|abc')).toBeNull();
    expect(parseRankedCursor('r1.not-a-uuid.3')).toBeNull();
    expect(parseRankedCursor(`r1.${sid}.-1`)).toBeNull();
    expect(parseRankedCursor(undefined)).toBeNull();
  });
});
