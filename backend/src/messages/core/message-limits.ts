import { BadRequestException } from '@nestjs/common';
import type { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { rateLimitException } from '../../common/rate-limit/rate-limit.response';

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

/**
 * Rate-limits a send.
 *
 * Lives here for exactly the reason `assertMessageTextWithinLimit` does: there
 * are TWO send implementations — `MessagingCoreService.sendMessage`, inherited
 * by the DM and group-chat services, and `MessagesService.sendMessage`, used by
 * the REST controller and the socket gateway — reached through four different
 * entry points (`/api/messages`, `/api/dm`, `/api/group-chats`, and the
 * `message:send` socket event). A limit written into one of them is absent from
 * the others, and the socket path carries almost all real traffic.
 *
 * Because the budget is keyed on the sender and the conversation rather than on
 * the route, all four entry points draw on the SAME allowance — so rotating
 * between the three URL aliases buys an abuser nothing.
 *
 * Two dimensions, both consumed:
 *   - per sender, which bounds total outbound volume;
 *   - per sender-and-conversation, which is what actually stops one person
 *     flooding one chat. A per-user limit alone permits all of it to land on a
 *     single victim.
 *
 * Call this AFTER the conversation has been resolved and the sender's
 * membership established, so a rejection can never reveal that a conversation
 * exists.
 */
export async function assertSendWithinRateLimit(
  rateLimit: RateLimitService,
  senderId: string,
  realConvId: string,
): Promise<void> {
  if (!senderId) return;

  const decision = await rateLimit.consumeAll([
    { policy: 'msg.send.user', identifier: senderId },
    ...(realConvId
      ? [
          {
            policy: 'msg.send.conversation' as const,
            identifier: `${senderId}:${realConvId}`,
          },
        ]
      : []),
  ]);

  if (!decision.allowed) throw rateLimitException(decision);
}

/**
 * The most conversations one forward may target.
 *
 * There was no cap at all: the array came straight from the client, and the
 * forward modal lets a user select every chat they have. That is a fan-out
 * amplifier — one request writing a message row into arbitrarily many
 * conversations and notifying every participant of each.
 *
 * A count limit, not a rate limit, and deliberately so: the rate limit bounds
 * how OFTEN you forward, this bounds how FAR a single forward reaches. The two
 * are set TOGETHER and must stay in step — 15 targets against a 30-per-minute
 * budget means two full-size forwards a minute. If the cap ever exceeds the
 * budget, every maximum-size forward is refused outright and the feature looks
 * broken rather than limited.
 */
export const MAX_FORWARD_TARGETS = 15;

/** Rejects a forward that fans out too far. */
export function assertForwardTargetsWithinLimit(targets: unknown): void {
  if (!Array.isArray(targets)) return;
  if (targets.length <= MAX_FORWARD_TARGETS) return;
  throw new BadRequestException(
    `You can forward to at most ${MAX_FORWARD_TARGETS} chats at once.`,
  );
}

/**
 * Rate-limits a forward.
 *
 * Costs one point PER TARGET CONVERSATION, not one per call. A forward carries
 * a list of destinations, so charging per call would let one request fan a
 * message out to fifty conversations for the price of one — which is exactly
 * the cheap spam primitive this limit exists to bound.
 *
 * Shared by both forward implementations for the same reason the send limit is
 * (see `assertSendWithinRateLimit`): three REST aliases reach two different
 * service methods.
 */
export async function assertForwardWithinRateLimit(
  rateLimit: RateLimitService,
  userId: string,
  targetConversationIds: string[],
): Promise<void> {
  if (!userId) return;

  // Bound the fan-out before charging for it, so an oversized request gets a
  // clear "at most N chats" message rather than being refused as rate limited.
  assertForwardTargetsWithinLimit(targetConversationIds);

  const targets = Array.isArray(targetConversationIds)
    ? targetConversationIds.length
    : 0;
  if (targets === 0) return;

  const decision = await rateLimit.consume('msg.forward.user', userId, targets);
  if (!decision.allowed) throw rateLimitException(decision);
}

/**
 * Rate-limits opening a NEW conversation.
 *
 * Existing threads are untouched — this bounds only first contact, which is the
 * unsolicited-contact vector. When the new conversation is a group it also
 * spends the group-creation budget, because a group additionally fans
 * invitations and notifications out to everyone in the founding roster.
 */
export async function assertNewConversationWithinRateLimit(
  rateLimit: RateLimitService,
  userId: string,
  isGroup: boolean,
): Promise<void> {
  if (!userId) return;

  const decision = await rateLimit.consumeAll([
    { policy: 'msg.startconv.user', identifier: userId },
    ...(isGroup
      ? [{ policy: 'msg.creategroup.user' as const, identifier: userId }]
      : []),
  ]);

  if (!decision.allowed) throw rateLimitException(decision);
}
