import type { DomainEventService } from '../events/domain-event.service';
import { detach } from '../common/utils/detach.util';

/**
 * What a group controller announces when someone leaves a group or is
 * removed from it: the membership event, and the line in the chat.
 *
 * The group-chats and the older messages controller each carried a copy, and
 * both wrote the line just AFTER the member's `leftAt`. A departed member's
 * history ends at `leftAt` (inclusive), so the one line about them was cut
 * from their own chat the moment they reloaded it: someone removed saw only
 * that they could no longer write, never who removed them. The line is now
 * written AT `leftAt`, so it is the last thing in their history.
 *
 * It also says what happened in a form the app can read (`payload.event`):
 * the person it is about reads "@admin removed you from the group" or "You
 * left the group", everyone else the stored text, which older apps show too.
 */

export type GroupDepartureEvent =
  | {
      kind: 'member_removed';
      actorId: string;
      actorHandle: string;
      targetId: string;
      targetHandle: string;
    }
  | { kind: 'member_left'; actorId: string; actorHandle: string };

/** The line as everyone else (and older apps) read it. */
export function departureLine(event: GroupDepartureEvent): string {
  return event.kind === 'member_removed'
    ? `${event.actorHandle} removed ${event.targetHandle} from the group`
    : `${event.actorHandle} left the group`;
}

export interface DepartureAnnouncer {
  events: DomainEventService;
  participantIds(internalId: string): Promise<string[]>;
  userHandle(userId: string): Promise<string>;
  systemLine(
    internalId: string,
    actorId: string,
    text: string,
    options: { createdAt: Date; event: GroupDepartureEvent },
  ): Promise<object>;
}

export interface Departure {
  internalId: string;
  publicId: string;
  /** The departure's own time (`leftAt`), ISO. */
  leftAt: string;
}

/**
 * After the reply: the membership event to the departed member and those
 * still in the group, then the line, live to the same people.
 */
export function announceDeparture(
  a: DepartureAnnouncer,
  departed: Departure,
  who: { actorId: string; targetUserId: string },
): void {
  const { actorId, targetUserId } = who;
  setImmediate(() =>
    detach('group member removed fan-out', async () => {
      const remainingIds = (await a.participantIds(departed.internalId)).filter(
        (id) => id !== targetUserId,
      );
      void a.events.emit(
        'group:member_removed',
        {
          conversationId: departed.publicId,
          publicId: departed.publicId,
          internalId: departed.internalId,
          targetUserId,
          removedBy: actorId,
          membershipChangedAt: departed.leftAt,
        },
        [targetUserId, ...remainingIds],
      );

      const [actorHandle, targetHandle] = await Promise.all([
        a.userHandle(actorId),
        actorId === targetUserId ? null : a.userHandle(targetUserId),
      ]);
      const event: GroupDepartureEvent =
        targetHandle === null
          ? { kind: 'member_left', actorId, actorHandle }
          : {
              kind: 'member_removed',
              actorId,
              actorHandle,
              targetId: targetUserId,
              targetHandle,
            };
      const message = await a.systemLine(
        departed.internalId,
        actorId,
        departureLine(event),
        { createdAt: new Date(departed.leftAt), event },
      );
      void a.events.emit('message:new', message, [
        targetUserId,
        ...remainingIds,
      ]);
    }),
  );
}
