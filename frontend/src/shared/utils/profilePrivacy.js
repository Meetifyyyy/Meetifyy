/**
 * Whether a profile's posts and connections are hidden from the viewer: the
 * account is private and the viewer does not follow it. A pending follow
 * request does not count as following, so it stays hidden until it is accepted.
 *
 * The server enforces this (it sends no posts and empty follower lists to such
 * a viewer); this only decides what the screen says about the emptiness.
 */
export function isHiddenFromViewer(profile, isOwnProfile) {
  if (!profile || isOwnProfile) return false;
  return !profile.isFollowing && Boolean(profile.isPrivate || profile.settings?.privateProfile);
}
