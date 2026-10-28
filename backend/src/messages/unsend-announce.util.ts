import type { DomainEventService } from '../events/domain-event.service';
import { UNSENT_PREVIEW } from './core/message-preview';

/** What MessagingCoreService.unsendMessage reports, as far as announcing it goes. */
export interface UnsendOutcome {
  changed: boolean;
  messageId: string;
  conversationId: string;
  publicId: string;
  participantIds: string[];
  wasLatest: boolean;
  createdAt: Date;
  senderId: string;
}

/**
 * Tells everyone who could have the message that it was unsent. The DM, group
 * and unified controllers each carried a copy of this.
 *
 * The message itself changes for all of them (`message:updated`, now with its
 * time, so a client can tell whether it is the one its list row shows). The
 * list preview changes only when it was the conversation's latest message:
 * every client used to rewrite its row to "This message was unsent" whatever
 * had been unsent, hiding the real latest message behind it.
 */
export function announceUnsent(
  events: DomainEventService,
  outcome: UnsendOutcome,
): void {
  if (!outcome.changed || !outcome.conversationId) return;
  const pubId = outcome.publicId || outcome.conversationId;
  const createdAt = new Date(outcome.createdAt).toISOString();
  setImmediate(() => {
    void events.emit(
      'message:updated',
      {
        id: outcome.messageId,
        conversationId: pubId,
        publicId: pubId,
        internalId: outcome.conversationId,
        createdAt,
        state: 'UNSENT',
        text: UNSENT_PREVIEW,
        mediaUrl: null,
        mediaType: null,
        inviteData: null,
        replyTo: null,
      },
      outcome.participantIds,
    );
    if (!outcome.wasLatest) return;
    void events.emit(
      'conversation:updated',
      {
        conversationId: pubId,
        publicId: pubId,
        internalId: outcome.conversationId,
        lastMessageText: UNSENT_PREVIEW,
        lastMessage: {
          id: outcome.messageId,
          text: UNSENT_PREVIEW,
          createdAt,
          senderId: outcome.senderId,
        },
      },
      outcome.participantIds,
    );
  });
}
