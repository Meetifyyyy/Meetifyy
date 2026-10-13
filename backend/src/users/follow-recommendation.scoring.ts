/**
 * The non-SQL half of "people you may know": choosing which of the ranked
 * candidates to show, and saying why each one is there.
 *
 * The SQL in `UsersService.getFollowRecommendations` scores a bounded pool and
 * returns the best `sampleFrom` of it. This file decides which `limit` of
 * those reach the screen. Kept pure so the selection can be tested without a
 * database.
 */

/** Why a candidate was suggested. Ordered strongest first: `pickReason`
 *  returns the first one that applies, so a person who is both a mutual and
 *  in the same branch is shown as a mutual. */
export type RecommendationReason =
  | 'follows_you'
  | 'mutuals'
  | 'same_branch'
  | 'shared_communities'
  | 'shared_interests'
  | 'same_college'
  | 'new_on_campus';

/** The scoring inputs one candidate carries out of the query. */
export interface RecommendationSignals {
  score: number;
  followsMe: boolean;
  mutualCount: number;
  sameBranch: boolean;
  sharedCommunities: number;
  sharedInterests: number;
  sameCollege: boolean;
}

export function pickReason(s: RecommendationSignals): RecommendationReason {
  if (s.followsMe) return 'follows_you';
  if (s.mutualCount > 0) return 'mutuals';
  if (s.sameBranch) return 'same_branch';
  if (s.sharedCommunities > 0) return 'shared_communities';
  if (s.sharedInterests > 0) return 'shared_interests';
  if (s.sameCollege) return 'same_college';
  return 'new_on_campus';
}
