import { describe, it, expect } from 'vitest';
import { communityReasonText, suggestionReasonText } from '../suggestionReason';

describe('suggestionReasonText', () => {
  it('names one mutual and counts the rest', () => {
    expect(suggestionReasonText({ reason: 'mutuals', mutualCount: 3, mutualSampleName: 'Rahul' }))
      .toBe('Followed by Rahul + 2 more');
    expect(suggestionReasonText({ reason: 'mutuals', mutualCount: 2, mutualSampleName: 'Rahul' }))
      .toBe('Followed by Rahul + 1 more');
    expect(suggestionReasonText({ reason: 'mutuals', mutualCount: 1, mutualSampleName: 'Rahul' }))
      .toBe('Followed by Rahul');
  });

  it('falls back to a count when no name came with the row', () => {
    expect(suggestionReasonText({ reason: 'mutuals', mutualCount: 4 })).toBe('4 mutuals');
  });

  it('maps the other reasons', () => {
    expect(suggestionReasonText({ reason: 'follows_you' })).toBe('Follows you');
    expect(suggestionReasonText({ reason: 'same_branch' })).toBe('Same branch');
    expect(suggestionReasonText({ reason: 'same_college' })).toBe('From your campus');
  });

  it('returns null for a payload without a known reason', () => {
    expect(suggestionReasonText({})).toBeNull();
    expect(suggestionReasonText({ reason: 'something_new' })).toBeNull();
    expect(suggestionReasonText(null)).toBeNull();
  });
});

describe('communityReasonText', () => {
  it('names a friend who joined', () => {
    expect(communityReasonText({ reason: 'friends_joined', friendCount: 1, friendSampleName: 'Asha' })).toBe('Asha joined');
    expect(communityReasonText({ reason: 'friends_joined', friendCount: 3, friendSampleName: 'Asha' })).toBe('Asha + 2 more joined');
    expect(communityReasonText({ reason: 'friends_joined', friendCount: 2 })).toBe('2 friends joined');
  });

  it('maps the other reasons', () => {
    expect(communityReasonText({ reason: 'matches_interests' })).toBe('Matches your interests');
    expect(communityReasonText({ reason: 'campus_members', campusMemberCount: 4 })).toBe('4 from your campus');
    expect(communityReasonText({ reason: 'active' })).toBe('Active this week');
  });

  it('returns null for popular or unknown, so the member count shows', () => {
    expect(communityReasonText({ reason: 'popular' })).toBeNull();
    expect(communityReasonText({})).toBeNull();
  });
});
