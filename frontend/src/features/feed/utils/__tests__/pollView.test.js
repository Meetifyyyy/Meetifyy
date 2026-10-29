import { describe, it, expect } from 'vitest';
import { mergePollCounts, pollPercentages, votedOptionIndex, hasVotedIn } from '../pollView';
import { withOptimisticVote } from '../../hooks/useVotePoll';

const poll = (over = {}) => ({
  options: [
    { id: 'a', text: 'First', votes: 1 },
    { id: 'b', text: 'Second', votes: 1 },
    { id: 'c', text: 'Third', votes: 1 },
  ],
  totalVotes: 3,
  ...over,
});

describe('poll percentages', () => {
  it('always add up to exactly 100', () => {
    expect(pollPercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(pollPercentages([2, 1])).toEqual([67, 33]);
    expect(pollPercentages([1, 1, 1, 1, 1, 1, 1])).toEqual([15, 15, 14, 14, 14, 14, 14]);
    for (const votes of [[3, 3, 1], [7, 0, 2, 5], [1, 2, 3, 4, 5]]) {
      expect(pollPercentages(votes).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('are all zero with no votes', () => {
    expect(pollPercentages([0, 0])).toEqual([0, 0]);
  });
});

describe("the viewer's vote", () => {
  it('is found by option id first: an index only names a place', () => {
    expect(votedOptionIndex(poll({ userVotedOptionId: 'c', votedOptionIndex: 0 }), 'me')).toBe(2);
    expect(votedOptionIndex(poll({ myVotes: [1] }), 'me')).toBe(1);
    expect(hasVotedIn(poll(), 'me')).toBe(false);
  });

  it('a vote shown at once counts it, and a second one changes nothing', () => {
    const once = withOptimisticVote(poll(), 'b', 'me');
    expect(once.totalVotes).toBe(4);
    expect(once.options[1].votes).toBe(2);
    expect(votedOptionIndex(once, 'me')).toBe(1);
    expect(withOptimisticVote(once, 'c', 'me')).toBe(once);
  });
});

describe('a live vote from someone else', () => {
  it("updates the counts and never marks the viewer as having voted", () => {
    // What an older server sent: the poll as the VOTER sees it.
    const update = {
      options: [
        { id: 'a', votes: 1 },
        { id: 'b', votes: 2 },
        { id: 'c', votes: 1 },
      ],
      totalVotes: 4,
      userVotedOptionId: 'b',
      votedOptionIndex: 1,
      myVotes: [1],
      selectedUsers: { someoneElse: [1] },
    };
    const merged = mergePollCounts(poll(), update);
    expect(merged.totalVotes).toBe(4);
    expect(merged.options.map((o) => o.votes)).toEqual([1, 2, 1]);
    expect(merged.options.map((o) => o.text)).toEqual(['First', 'Second', 'Third']);
    expect(hasVotedIn(merged, 'me')).toBe(false);
  });

  it("leaves the viewer's own vote as it was", () => {
    const mine = poll({ userVotedOptionId: 'a', myVotes: [0] });
    const merged = mergePollCounts(mine, { options: [{ id: 'c', votes: 9 }], totalVotes: 11 });
    expect(votedOptionIndex(merged, 'me')).toBe(0);
    expect(merged.options[2].votes).toBe(9);
  });
});
