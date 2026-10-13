import { pickCommunityReason } from './community-recommendation.scoring';

describe('pickCommunityReason', () => {
  const none = {
    friendCount: 0,
    campusMemberCount: 0,
    interestMatch: false,
    recentPosts: 0,
  };

  it('puts friends first, then interests, campus, activity', () => {
    expect(
      pickCommunityReason({ ...none, friendCount: 1, interestMatch: true }),
    ).toBe('friends_joined');
    expect(
      pickCommunityReason({ ...none, interestMatch: true, recentPosts: 9 }),
    ).toBe('matches_interests');
    expect(
      pickCommunityReason({ ...none, campusMemberCount: 3, recentPosts: 9 }),
    ).toBe('campus_members');
    expect(pickCommunityReason({ ...none, recentPosts: 3 })).toBe('active');
  });

  it('does not call two campus members a campus community', () => {
    expect(pickCommunityReason({ ...none, campusMemberCount: 2 })).toBe(
      'popular',
    );
  });
});
