/**
 * The one-line "why" under a follow suggestion, from the `reason` the server
 * ranked it on (see backend follow-recommendation.scoring.ts).
 *
 * Returns null for an unknown or missing reason — a payload from a server
 * that predates the field — so the caller falls back to the @handle.
 */
export function suggestionReasonText(user) {
  if (!user) return null;
  const mutuals = Number(user.mutualCount) || 0;
  switch (user.reason) {
    case 'follows_you':
      return 'Follows you';
    case 'mutuals': {
      const name = user.mutualSampleName;
      if (!name) return mutuals === 1 ? '1 mutual' : `${mutuals} mutuals`;
      const others = mutuals - 1;
      if (others <= 0) return `Followed by ${name}`;
      return `Followed by ${name} + ${others} more`;
    }
    case 'same_branch':
      return 'Same branch';
    case 'shared_communities':
      return 'In your communities';
    case 'shared_interests':
      return 'Similar interests';
    case 'same_college':
      return 'From your campus';
    case 'new_on_campus':
      return 'New to Meetifyy';
    default:
      return null;
  }
}

/**
 * The one-line "why" under a suggested community, from the `reason` the
 * server ranked it on (see backend community-recommendation.scoring.ts).
 * Null for a payload without one, so the caller falls back to member count.
 */
export function communityReasonText(community) {
  if (!community) return null;
  const friends = Number(community.friendCount) || 0;
  switch (community.reason) {
    case 'friends_joined': {
      const name = community.friendSampleName;
      if (!name) return friends === 1 ? '1 friend joined' : `${friends} friends joined`;
      const others = friends - 1;
      return others <= 0 ? `${name} joined` : `${name} + ${others} more joined`;
    }
    case 'matches_interests':
      return 'Matches your interests';
    case 'campus_members':
      return `${Number(community.campusMemberCount) || 0} from your campus`;
    case 'active':
      return 'Active this week';
    default:
      return null;
  }
}
