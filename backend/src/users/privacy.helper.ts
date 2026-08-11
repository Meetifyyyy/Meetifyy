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

/**
 * Transpose of checkPresenceVisibilityBatch: given ONE viewer and MANY targets
 * (each with its own privacy rule), return the set of target user IDs whose
 * online status this viewer is allowed to see.
 *
 * Replaces the per-target `checkPresenceVisibility` calls that the conversation
 * and DM list endpoints previously ran inside a map — those re-queried the
 * viewer's own `userSettings` row once per online conversation (an N+1 on the
 * same row) plus a `follow` lookup per row. This does one viewer-settings read
 * and at most two batched `follow` queries total.
 */
export async function resolvePresenceVisibilityForViewer(
  viewerUserId: string,
  targets: { userId: string; rule: string; isEnabled: boolean }[],
  prisma: PrismaService
): Promise<Set<string>> {
  const visible = new Set<string>();
  if (!viewerUserId || targets.length === 0) return visible;

  // Reciprocity: a viewer who hid their own online status sees nobody.
  const viewerSettings = await prisma.userSettings.findUnique({
    where: { userId: viewerUserId },
    select: { showOnlineStatus: true }
  });
  if (viewerSettings && viewerSettings.showOnlineStatus === false) return visible;

  const followingTargets: string[] = [];
  const mutualTargets: string[] = [];

  for (const t of targets) {
    if (!t.isEnabled || !t.userId) continue;
    if (t.userId === viewerUserId) { visible.add(t.userId); continue; }
    const rule = t.rule || 'everyone';
    if (rule === 'nobody') continue;
    if (rule === 'everyone') { visible.add(t.userId); continue; }
    if (rule === 'following') followingTargets.push(t.userId);
    else if (rule === 'mutual') mutualTargets.push(t.userId);
    else visible.add(t.userId); // unknown rule → default visible (matches single-item helper)
  }

  // 'following': target follows the viewer.
  if (followingTargets.length > 0) {
    const follows = await prisma.follow.findMany({
      where: { followerId: { in: followingTargets }, followingId: viewerUserId },
      select: { followerId: true }
    });
    for (const f of follows) visible.add(f.followerId);
  }

  // 'mutual': target follows viewer AND viewer follows target.
  if (mutualTargets.length > 0) {
    const [targetFollowsViewer, viewerFollowsTarget] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: { in: mutualTargets }, followingId: viewerUserId },
        select: { followerId: true }
      }),
      prisma.follow.findMany({
        where: { followerId: viewerUserId, followingId: { in: mutualTargets } },
        select: { followingId: true }
      })
    ]);
    const tfv = new Set(targetFollowsViewer.map(f => f.followerId));
    const vft = new Set(viewerFollowsTarget.map(f => f.followingId));
    for (const id of mutualTargets) if (tfv.has(id) && vft.has(id)) visible.add(id);
  }

  return visible;
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
