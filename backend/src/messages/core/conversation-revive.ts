import type { DomainEventService } from '../../events/domain-event.service';

/**
 * A new message brings a conversation back for every member who had deleted
 * (hidden) it. Their sockets joined the conversation's rooms at connect, and a
 * hidden conversation is skipped there, so until they reconnected they got the
 * message (it goes to their own room) but not the typing, read and presence
 * events that only go to the conversation's rooms. This event has the gateway
 * join those rooms for them as the conversation returns.
 */
export const CONVERSATION_REVIVED = 'conversation:revived';

/** The members the send is about to un-hide: still in it, but hidden. */
export function revivedMemberIds(
  participants: ReadonlyArray<{ userId: string; deletedAt: Date | null }>,
): string[] {
  return participants.filter((p) => Boolean(p.deletedAt)).map((p) => p.userId);
}

/** Called once the send has committed. Server-side only: clients never see it. */
export function announceRevived(
  events: DomainEventService,
  ids: { conversationId: string; publicId: string | null; internalId: string },
  userIds: string[],
): void {
  if (userIds.length === 0) return;
  // Fire-and-forget: room joins must never hold up or fail a delivered message.
  void events.emit(
    CONVERSATION_REVIVED,
    {
      conversationId: ids.conversationId,
      ...(ids.publicId ? { publicId: ids.publicId } : {}),
      internalId: ids.internalId,
      userIds,
    },
    userIds,
  );
}
