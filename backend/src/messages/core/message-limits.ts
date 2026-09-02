import { BadRequestException } from '@nestjs/common';

/**
 * The longest message body the server will store.
 *
 * There was no limit at all. The only thing bounding a message was the body
 * parser's default (~100 KB), so a single send could persist a 100 KB row,
 * fan it out over sockets to every participant, and land it in each client's
 * message cache to be laid out and rendered. Nothing about that is a security
 * hole - the text is stored as data and escaped on render - but it is a cheap
 * way to bloat the table and stall a chat pane, and there was no reason for it
 * to be possible.
 *
 * Characters, not bytes. A byte limit would silently cut a Hindi or emoji
 * message far shorter than an English one of the same visible length, and the
 * number a person is shown ("5000 characters") has to be the number actually
 * enforced.
 */
export const MAX_MESSAGE_TEXT_LENGTH = 5000;

/**
 * Rejects an over-long message body.
 *
 * Lives here rather than in either service because there are TWO send
 * implementations - `MessagingCoreService.sendMessage`, inherited by the DM and
 * group-chat services, and `MessagesService.sendMessage`, used by the REST
 * controller and the socket gateway. A limit written into one of them would be
 * absent from the other, and the socket path is the one that carries almost all
 * real traffic.
 *
 * Length is measured on the raw string, matching `@MaxLength` on the DTO
 * exactly, so the two layers cannot disagree about which messages are legal.
 */
export function assertMessageTextWithinLimit(text: unknown): void {
  if (typeof text !== 'string') return;
  if (text.length <= MAX_MESSAGE_TEXT_LENGTH) return;
  throw new BadRequestException(
    `Message is too long. The limit is ${MAX_MESSAGE_TEXT_LENGTH} characters.`,
  );
}
