import type { PrismaService } from '../prisma/prisma.service';

/**
 * Everyone who shares a live conversation with `userId`: the people a change
 * in their online status may be shown to (before the privacy rules, blocks
 * and the viewers' own settings, which checkPresenceVisibilityBatch applies).
 *
 * "Live" on both sides: the user has neither left nor hidden the conversation,
 * and neither has the other member.
 *
 * This runs on every connect and disconnect. It used to read one row per
 * membership — every member of every conversation the user is in — and
 * de-duplicate in the server, so someone in ten full groups pulled about 500
 * rows to find the people among them. The database now returns each person
 * once, reading both sides from the participant indexes
 * (`userId, deletedAt, leftAt` and `conversationId, deletedAt, leftAt, userId`).
 */
export async function presenceViewerIds(
  prisma: Pick<PrismaService, '$queryRaw'>,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT other."userId"
    FROM "ConversationParticipant" me
    JOIN "ConversationParticipant" other
      ON other."conversationId" = me."conversationId"
    WHERE me."userId" = ${userId}
      AND me."deletedAt" IS NULL
      AND me."leftAt" IS NULL
      AND other."deletedAt" IS NULL
      AND other."leftAt" IS NULL
      AND other."userId" <> ${userId}
  `;
  return rows.map((row) => row.userId);
}
