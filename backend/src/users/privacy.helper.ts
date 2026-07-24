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
