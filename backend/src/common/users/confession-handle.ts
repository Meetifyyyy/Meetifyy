import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Whether `username` is somebody's confession handle: the reverse of the
 * rule that no handle may be a real username (FEAT-11).
 *
 * A username equal to a handle would make that handle's confessions look
 * like this person's, so every path that chooses a username refuses one,
 * and the automatic paths pick another. The answer the user sees is the same
 * "not available" as for a reserved name, so it never reveals that a handle
 * exists.
 */
export async function isConfessionHandle(
  prisma: Pick<PrismaService, 'confessionProfile'>,
  username: string,
): Promise<boolean> {
  const found = await prisma.confessionProfile.findUnique({
    where: { handleKey: username.toLowerCase() },
    select: { id: true },
  });
  return found !== null;
}
