/**
 * The follower and following counts shown for the signed-in user (the
 * header and the mobile drawer), in order of trust: the live profile query,
 * then the session's own counts, then, from a server that predates those
 * counts (ID-16), the length of the session's lists.
 *
 * `??`, not `||`: zero is a real answer and must not fall through.
 */
export function ownFollowCounts(profile, currentUser) {
  return {
    followers: profile?.stats?.followers
      ?? profile?.followersCount
      ?? currentUser?.followersCount
      ?? currentUser?.followersList?.length
      ?? 0,
    following: profile?.stats?.following
      ?? profile?.followingCount
      ?? currentUser?.followingCount
      ?? currentUser?.followingList?.length
      ?? 0,
  };
}
