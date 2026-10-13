import {
  RecommendationSignals,
  pickReason,
} from './follow-recommendation.scoring';
import { weightedSample } from '../common/utils/weighted-sample.util';

const none: RecommendationSignals = {
  score: 0,
  followsMe: false,
  mutualCount: 0,
  sameBranch: false,
  sharedCommunities: 0,
  sharedInterests: 0,
  sameCollege: false,
};

describe('pickReason', () => {
  it('prefers the strongest applicable reason', () => {
    expect(
      pickReason({
        ...none,
        followsMe: true,
        mutualCount: 4,
        sameBranch: true,
      }),
    ).toBe('follows_you');
    expect(pickReason({ ...none, mutualCount: 2, sameBranch: true })).toBe(
      'mutuals',
    );
    expect(pickReason({ ...none, sameBranch: true, sameCollege: true })).toBe(
      'same_branch',
    );
    expect(
      pickReason({ ...none, sharedCommunities: 1, sharedInterests: 3 }),
    ).toBe('shared_communities');
    expect(pickReason({ ...none, sharedInterests: 1, sameCollege: true })).toBe(
      'shared_interests',
    );
    expect(pickReason({ ...none, sameCollege: true })).toBe('same_college');
  });

  it('falls back to a neutral reason when nothing applies', () => {
    expect(pickReason(none)).toBe('new_on_campus');
  });
});

describe('weightedSample', () => {
  const rows = (scores: number[]) =>
    scores.map((score, i) => ({ id: `u${i}`, score }));

  it('returns the whole pool when it is no larger than the count', () => {
    expect(weightedSample(rows([1, 2]), 3)).toHaveLength(2);
  });

  it('draws distinct rows from the pool', () => {
    const picked = weightedSample(rows([1, 1, 1, 1, 1, 1]), 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((r) => r.id)).size).toBe(3);
  });

  it('shows strong matches far more often than weak ones', () => {
    // One strong candidate among nineteen weak ones, drawing three.
    const pool = rows([10, ...Array.from({ length: 19 }, () => 0.5)]);
    let strongShown = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i++) {
      if (weightedSample(pool, 3).some((r) => r.id === 'u0')) strongShown++;
    }
    // Uniform selection would show it ~15% of the time.
    expect(strongShown / runs).toBeGreaterThan(0.8);
  });

  it('still varies between draws, so the panel changes on reload', () => {
    const pool = rows(Array.from({ length: 30 }, (_, i) => 1 + i / 10));
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(
        weightedSample(pool, 3)
          .map((r) => r.id)
          .join(','),
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('treats an all-zero pool as uniform rather than returning nothing', () => {
    expect(weightedSample(rows([0, 0, 0, 0, 0]), 2)).toHaveLength(2);
  });

  it('is deterministic for a given random source', () => {
    const pool = rows([3, 1, 2, 5, 4]);
    const seq = () => {
      let n = 0;
      return () => [0.1, 0.9, 0.5, 0.3, 0.7][n++ % 5];
    };
    expect(weightedSample(pool, 2, seq())).toEqual(
      weightedSample(pool, 2, seq()),
    );
  });
});
