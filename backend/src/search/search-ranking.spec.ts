import { PERSONAL_CAP, TIER, TIER_GAP, escapeLike } from './search-ranking';

describe('search ranking', () => {
  it('escapes LIKE metacharacters so they match literally', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike('plain')).toBe('plain');
  });

  it('keeps every tier further apart than the personal signals can reach', () => {
    const tiers = Object.values(TIER).sort((a, b) => b - a);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i - 1] - tiers[i]).toBeGreaterThanOrEqual(TIER_GAP);
    }
    // The guarantee the module states: who you are only breaks ties within
    // a match tier, never lifts a weaker match above a stronger one.
    expect(PERSONAL_CAP).toBeLessThan(TIER_GAP);
  });
});
