import { PrismaService } from '../prisma/prisma.service';

export async function checkPresenceVisibility(
  targetUserId: string,
  viewerUserId: string,
  rule: 'everyone' | 'following' | 'mutual' | 'nobody' | string,
  isEnabled: boolean,
  prisma: PrismaService
): Promise<boolean> {
  if (!isEnabled) return false;
  if (!targetUserId) return false;
  if (targetUserId === viewerUserId) return true;

  // RULE: If viewer hides their own online status, they cannot see others'
  const viewerSettings = await prisma.userSettings.findUnique({
    where: { userId: viewerUserId },
    select: { showOnlineStatus: true }
  });
  if (viewerSettings && viewerSettings.showOnlineStatus === false) return false;

  if (rule === 'nobody') return false;
  if (rule === 'everyone' || !rule) return true;

  if (rule === 'following') {
    // Check if target user follows the viewer
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: targetUserId,
          followingId: viewerUserId,
        }
      }
    });
    return !!follow;
  }

  if (rule === 'mutual') {
    // Check if both target user follows viewer AND viewer follows target user
    const [targetFollowsViewer, viewerFollowsTarget] = await Promise.all([
      prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: targetUserId,
            followingId: viewerUserId,
          }
        }
      }),
      prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: viewerUserId,
            followingId: targetUserId,
          }
        }
      })
    ]);
    return !!(targetFollowsViewer && viewerFollowsTarget);
  }

  return true;
}

export async function checkPresenceVisibilityBatch(
  targetUserId: string,
  viewerUserIds: string[],
  rule: 'everyone' | 'following' | 'mutual' | 'nobody' | string,
  isEnabled: boolean,
  prisma: PrismaService
): Promise<string[]> {
  if (!isEnabled || !targetUserId || rule === 'nobody' || viewerUserIds.length === 0) return [];

  // Filter out viewers who have hidden their own online status
  const viewerSettings = await prisma.userSettings.findMany({
    where: { userId: { in: viewerUserIds } },
    select: { userId: true, showOnlineStatus: true }
  });
  
  const hiddenViewers = new Set(
    viewerSettings.filter(s => s.showOnlineStatus === false).map(s => s.userId)
  );

  const eligibleViewers = viewerUserIds.filter(vId => !hiddenViewers.has(vId));
  if (eligibleViewers.length === 0) return [];

  if (rule === 'everyone' || !rule) return eligibleViewers;

  if (rule === 'following') {
    const follows = await prisma.follow.findMany({
      where: {
        followerId: targetUserId,
        followingId: { in: eligibleViewers }
      },
      select: { followingId: true }
    });
    return follows.map(f => f.followingId);
  }

  if (rule === 'mutual') {
    const targetFollows = await prisma.follow.findMany({
      where: { followerId: targetUserId, followingId: { in: eligibleViewers } },
      select: { followingId: true }
    });
    const targetFollowsSet = new Set(targetFollows.map(f => f.followingId));

    if (targetFollowsSet.size === 0) return [];

    const viewerFollows = await prisma.follow.findMany({
      where: { followerId: { in: eligibleViewers }, followingId: targetUserId },
      select: { followerId: true }
    });
    const viewerFollowsSet = new Set(viewerFollows.map(f => f.followerId));

    return eligibleViewers.filter(vId => targetFollowsSet.has(vId) && viewerFollowsSet.has(vId));
  }

  return eligibleViewers;
}
