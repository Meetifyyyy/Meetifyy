import {
  PERSONAL_CAP,
  TIER,
  TIER_GAP,
  communitySearchSql,
  escapeLike,
  userSearchSql,
} from './search-ranking';

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

  describe('same-college signal reads the active affiliation', () => {
    it('people search: viewer and candidate both by CollegeAffiliation', () => {
      const sql = userSearchSql({
        query: 'asha',
        viewerId: 'me',
        excludedIds: [],
        includeBio: false,
        take: 10,
      }).sql;
      // Viewer: revoked rows and closed colleges grant nothing.
      expect(sql).toContain('FROM "CollegeAffiliation" a');
      expect(sql).toContain('a."revokedAt" IS NULL');
      expect(sql).toContain(`ac."status" = 'APPROVED'`);
      // Candidate: an EXISTS on its own affiliation, not the mirror.
      expect(sql).toContain('a."userId" = u."id"');
      expect(sql).not.toContain('me."collegeId" = u."collegeId"');
    });

    it('community search: campus-only communities follow the viewer affiliation', () => {
      const sql = communitySearchSql({
        query: 'chess',
        viewerId: 'me',
        includeDescription: false,
        take: 10,
      }).sql;
      expect(sql).toContain('FROM "CollegeAffiliation" a');
      expect(sql).toContain('c."collegeId" = me."collegeId"');
    });
  });
});
