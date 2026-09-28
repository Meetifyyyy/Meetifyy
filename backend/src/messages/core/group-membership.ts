import { BadRequestException } from '@nestjs/common';
import { ConversationType } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Refuses a membership action — add, remove, leave — on anything but a group.
 *
 * Those routes resolve any conversation id and then check a role, and the
 * creator of a DM is its OWNER: without this, a DM's creator could remove the
 * other person or pull a third one into a private thread, and an Instant
 * Match chat could be given extra members. No client offers these actions
 * outside a group (Instant Match leaves over its socket).
 *
 * A conversation that does not exist is left to the caller's own handling.
 */
export async function assertGroupConversation(
  prisma: Pick<PrismaService, 'conversation'>,
  conversationId: string,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true },
  });
  if (conversation && conversation.type !== ConversationType.GROUP) {
    throw new BadRequestException(
      'Only group chats have members to add, remove or leave.',
    );
  }
}

/** A participant row that is still in the conversation. */
export function isActiveParticipant(
  participant: { leftAt: Date | null; deletedAt: Date | null } | null,
): boolean {
  return Boolean(participant && !participant.leftAt && !participant.deletedAt);
}
