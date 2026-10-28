import { DomainEventService } from '../events/domain-event.service';

/**
 * Split a `message:new` fan-out by the recipients' mute state.
 *
 * Muting must not stop the message: it still has to be stored and synced like
 * any other, or a muted chat silently loses history. What mute suppresses is
 * the *alert* — toast, banner, sound. So the message goes to everyone and the
 * server stamps each copy with whether that recipient may be alerted for it.
 *
 * The flag is server-authoritative on purpose. Deciding this on the client
 * from its cached conversation list meant a client with a stale or missing
 * cache — a fresh tab, a cold load, a device that never saw the mute — alerted
 * for a chat the user had muted. `alert` travels with the payload instead, so
 * every device honours the mute without needing to know about it first.
 *
 * `sendMessage` already computes both id lists in one batched query, so this
 * costs no extra round trip.
 */
/**
 * A message as clients receive it: never the server's lists of whom it went
 * to and who had muted the chat. Those used to travel in every copy (and in
 * the sender's own response), so any member could read off who had muted the
 * group.
 */
export function publicMessage<T extends object>(
  message: T,
): Omit<T, 'recipientIds' | 'unmutedRecipientIds'> {
  const copy = Object.fromEntries(
    Object.entries(message).filter(
      ([key]) => key !== 'recipientIds' && key !== 'unmutedRecipientIds',
    ),
  );
  return copy as Omit<T, 'recipientIds' | 'unmutedRecipientIds'>;
}

export function emitMessageNew(
  domainEventService: DomainEventService,
  message: object,
  opts: {
    recipientIds: string[];
    unmutedRecipientIds: string[];
    senderId?: string;
  },
): Promise<void>[] {
  const unmuted = new Set(opts.unmutedRecipientIds || []);
  const recipients = opts.recipientIds || [];
  message = publicMessage(message);
  const mutedIds = recipients.filter((id) => !unmuted.has(id));
  const unmutedIds = recipients.filter((id) => unmuted.has(id));

  const emits: Promise<void>[] = [];
  if (unmutedIds.length > 0) {
    emits.push(
      domainEventService.emit(
        'message:new',
        { ...message, alert: true },
        unmutedIds,
      ),
    );
  }
  if (mutedIds.length > 0) {
    emits.push(
      domainEventService.emit(
        'message:new',
        { ...message, alert: false },
        mutedIds,
      ),
    );
  }
  // The sender's other devices get the message for multi-device sync, never an
  // alert — they already know, they sent it.
  if (opts.senderId) {
    emits.push(
      domainEventService.emit('message:new', { ...message, alert: false }, [
        opts.senderId,
      ]),
    );
  }
  return emits;
}
