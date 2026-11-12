/**
 * The one visibility rule for content that sits in a community, shared by
 * `PostsService` (every single-post route) and the realtime gateway (the
 * `post_<id>` room), so a socket can never be looser than the REST read.
 *
 *  - a deleted community is gone;
 *  - a campus community is limited to people whose ACTIVE campus affiliation
 *    is that college (membership rows outlive affiliation changes, so
 *    membership alone is not enough);
 *  - a private community is limited to its owner and members.
 *
 * The viewer's college is looked up lazily, so only campus communities pay
 * for the query.
 */
export interface CommunityVisibilityFields {
  deletedAt: Date | null;
  isPrivate: boolean;
  isCampusCommunity: boolean;
  collegeId: string | null;
  ownerId: string | null;
  /** The viewer's own membership row, if any (at most one is needed). */
  members?: Array<{ userId: string }>;
}

export async function canViewCommunity(
  userId: string,
  community: CommunityVisibilityFields,
  activeCollegeId: (userId: string) => Promise<string | null>,
): Promise<boolean> {
  if (community.deletedAt) return false;
  if (community.isCampusCommunity && community.collegeId) {
    const viewerCollegeId = await activeCollegeId(userId);
    if (viewerCollegeId !== community.collegeId) return false;
  }
  if (community.isPrivate) {
    const isOwner = !!userId && community.ownerId === userId;
    const isMember = (community.members?.length ?? 0) > 0;
    if (!isOwner && !isMember) return false;
  }
  return true;
}
