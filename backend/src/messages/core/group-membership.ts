import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConversationType, type Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { MAX_GROUP_MEMBERS } from './message-limits';

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

/**
 * The machine-readable reason a request from someone who is no longer in a
 * conversation is refused. Clients switch on it to show "You're no longer in
 * this group" and resync the conversation, instead of a generic failure.
 */
export const NOT_A_MEMBER = 'NOT_A_MEMBER';

export function notAMemberError(
  message = 'You are no longer a member of this conversation',
): ForbiddenException {
  return new ForbiddenException({ code: NOT_A_MEMBER, message });
}

/**
 * The machine-readable reason someone cannot be admitted to a group that is
 * at its ceiling. The message reads on its own for builds that predate it.
 */
export const GROUP_FULL = 'GROUP_FULL';

export function groupFullError(): BadRequestException {
  return new BadRequestException({
    code: GROUP_FULL,
    message: `This group is full. A group can have up to ${MAX_GROUP_MEMBERS} members.`,
  });
}

/**
 * Refuses to found a group of more than MAX_GROUP_MEMBERS people, counting
 * the creator and each person once.
 */
export function assertFoundingGroupSize(memberIds: readonly string[]): void {
  if (new Set(memberIds).size > MAX_GROUP_MEMBERS) throw groupFullError();
}

/**
 * Takes the group's row lock, then refuses to admit `userId` if the group is
 * full. Run first in the transaction that writes the membership.
 *
 * The lock is what makes the ceiling hold: two joins that each counted 49
 * members would otherwise both insert. With it, the second waits for the first
 * to commit and its count, a new statement under READ COMMITTED, sees the
 * first one's row. It is the lock a send and a removal take on the same row
 * (markParticipantLeft), held only for this short transaction.
 *
 * Everyone not yet gone counts — a member who only hid the chat is still in
 * it — except `userId`, so re-admitting someone already counted (a hidden
 * member added again) is never refused.
 */
export async function lockGroupSeat(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId}
    FOR NO KEY UPDATE
  `;
  const others = await tx.conversationParticipant.count({
    where: { conversationId, leftAt: null, userId: { not: userId } },
  });
  if (others >= MAX_GROUP_MEMBERS) throw groupFullError();
}

/**
 * Whether the group has no place for `userId`, without a lock: for refusing
 * early (an invite card, a join request) where nothing is written that the
 * ceiling protects. The admitting write checks again under the lock.
 */
export async function isGroupFull(
  prisma: Pick<PrismaService, 'conversationParticipant'>,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const others = await prisma.conversationParticipant.count({
    where: { conversationId, leftAt: null, userId: { not: userId } },
  });
  return others >= MAX_GROUP_MEMBERS;
}

type GroupRole = 'OWNER' | 'ADMIN' | 'MEMBER';

/**
 * Authority for a group action, decided from the participant row as it is now.
 *
 * Removing someone or leaving sets `leftAt` and nothing else used to change, so
 * a removed admin's row still said ADMIN and an owner who left still said
 * OWNER. Every admin check read the role alone, so a former admin could go on
 * removing members, accepting requests, or (a former owner) ending the group.
 * Membership is checked first, from `leftAt`; a member who merely hid the chat
 * (`deletedAt`) is still in the group and keeps their role.
 */
export function assertGroupAuthority(
  participant: { role: string; leftAt: Date | null } | null,
  roles: readonly GroupRole[],
  refusal: string,
): void {
  if (!participant || participant.leftAt) throw notAMemberError();
  if (!roles.includes(participant.role as GroupRole)) {
    throw new ForbiddenException(refusal);
  }
}

/**
 * Spread into every write that brings a former member back: the snapshot
 * markParticipantLeft took is theirs only while they are gone.
 */
export const CLEARED_LEFT_SNAPSHOT = {
  leftGroupName: null,
  leftGroupAvatarKey: null,
} as const;

/**
 * Takes `userId` out of the group, once.
 *
 * The conversation row is locked first, in the same transaction, because a
 * send takes the same lock before it checks the sender is still a member
 * (MessagingCoreService.sendMessageOnce, MessagesService.sendViaSocketPath).
 * Whichever commits first wins: a send that got the lock first lands before
 * the removal, and one that waited behind it is refused. Without the shared
 * lock a send that had already passed its membership check could insert a
 * message from someone who had been removed a moment earlier.
 *
 * The role goes back to MEMBER, so a row left behind can never be read as an
 * admin again. The group's name and photo at this moment stay on the row: a
 * former member's list shows the group as it was when they left, not its later
 * renames, photos and member counts. `changed` is false when the user was
 * already gone (a second request, or two admins removing the same person at
 * once): the caller then announces nothing.
 */
export async function markParticipantLeft(
  prisma: Pick<
    PrismaService,
    '$transaction' | 'conversation' | 'conversationParticipant'
  >,
  conversationId: string,
  userId: string,
  at: Date = new Date(),
): Promise<{ changed: boolean; leftAt: Date; publicId: string | null }> {
  const [conversation, result] = await prisma.$transaction(async (tx) => {
    const group = await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: at },
      select: { publicId: true, name: true, avatarKey: true },
    });
    const left = await tx.conversationParticipant.updateMany({
      where: { conversationId, userId, leftAt: null },
      data: {
        leftAt: at,
        role: 'MEMBER',
        // Unread goes too: a former member can no longer mark the group read,
        // so whatever was unread when they left would count for ever.
        unreadCount: 0,
        leftGroupName: group.name,
        leftGroupAvatarKey: group.avatarKey,
      },
    });
    return [group, left] as const;
  });
  return {
    changed: result.count > 0,
    leftAt: at,
    publicId: conversation.publicId,
  };
}

/**
 * The group as one viewer's conversation list shows it. A former member sees
 * it as it was when they left (the snapshot markParticipantLeft took), with no
 * member count or description: those are the live group's, which they are no
 * longer part of. Anyone still in it sees the group as it is now. A row from
 * before the snapshot existed falls back to the live name and photo.
 */
export function groupAsSeenBy(
  viewer: {
    leftAt: Date | null;
    leftGroupName: string | null;
    leftGroupAvatarKey: string | null;
  },
  group: {
    name: string | null;
    avatarKey: string | null;
    description: string | null;
    memberCount: number;
  },
): {
  name: string;
  avatar: string | null;
  description: string | null;
  memberCount: number;
} {
  const former = viewer.leftAt != null;
  const snapshot = former && viewer.leftGroupName !== null;
  return {
    name: (snapshot ? viewer.leftGroupName : group.name) || 'Group',
    avatar: (snapshot ? viewer.leftGroupAvatarKey : group.avatarKey) || null,
    description: former ? null : group.description || null,
    memberCount: former ? 0 : group.memberCount,
  };
}

/**
 * When the viewer's membership last changed (left, or joined), as the server
 * recorded it. Clients keep whichever membership statement carries the later
 * stamp, so an older response or a repeated event cannot undo a newer change.
 */
export function membershipChangedAt(
  participant:
    { leftAt: Date | null; joinedAt?: Date | null } | null | undefined,
): string | null {
  const at = participant?.leftAt ?? participant?.joinedAt;
  return at ? at.toISOString() : null;
}
