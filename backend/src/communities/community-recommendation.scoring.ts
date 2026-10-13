/**
 * Why a community was suggested in "Discover Communities", from the signals
 * `CommunitiesService.getCommunityRecommendations` scores it on.
 *
 * The question a viewer asks of a community is "is it worth joining?", which
 * is a different question from "do I know this person?" — so these are not the
 * people-suggestion reasons. People they know being in it comes first, then
 * whether it is about something they care about, then whether it is alive.
 */
export type CommunityReason =
  | 'friends_joined'
  | 'campus_members'
  | 'matches_interests'
  | 'active'
  | 'popular';

export interface CommunitySignals {
  friendCount: number;
  campusMemberCount: number;
  interestMatch: boolean;
  recentPosts: number;
}

/** A community with this many posts in the activity window counts as active. */
export const ACTIVE_POSTS_THRESHOLD = 3;

export function pickCommunityReason(s: CommunitySignals): CommunityReason {
  if (s.friendCount > 0) return 'friends_joined';
  if (s.interestMatch) return 'matches_interests';
  if (s.campusMemberCount >= 3) return 'campus_members';
  if (s.recentPosts >= ACTIVE_POSTS_THRESHOLD) return 'active';
  return 'popular';
}
