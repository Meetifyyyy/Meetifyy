import { randomUUID } from 'crypto';
import { retryOnClientIdConflict, withClientSendLock } from './send-lock';
import type { RedisService } from '../../redis/redis.service';
import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorageService } from '../../uploads/uploads.service';
import { storableInviteData, withInviteExpiry } from './invite-data';
import {
  arrayOrEmpty,
  payloadFields,
  stringOrEmpty,
  stringOrNull,
} from './message-payload';
import { isJsonValue } from '../../common/utils/json.util';
import { MentionSource, NotificationEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../users/blocks.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { MentionsService } from '../../mentions/mentions.service';
import { buildReplyToSnapshot, REPLY_TO_SELECT } from '../reply-preview.util';
import {
  VerificationAccessService,
  verificationRequiredException,
} from '../../common/verification/verification-access.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import {
  isUnavailableUser,
  presentUserName,
  presentUserAvatar,
} from '../../common/users/deleted-user';
import {
  asBoolean,
  asNumberOrNull,
  asString,
  asStringOrNull,
} from '../../common/utils/coerce.util';
import {
  assertMessageTextWithinLimit,
  assertSendWithinRateLimit,
  assertForwardWithinRateLimit,
} from './message-limits';
import {
  assertGroupAuthority,
  assertGroupConversation,
  isActiveParticipant,
  markParticipantLeft,
  CLEARED_LEFT_SNAPSHOT,
  membershipChangedAt,
  notAMemberError,
} from './group-membership';
import { announceRevived, revivedMemberIds } from './conversation-revive';
import { previewText, UNSENT_PREVIEW } from './message-preview';
import {
  everyoneSpan,
  mentionNotifyIds,
  peopleMentions,
  storedMentions,
} from './message-mentions';
import {
  isWithinUnsendWindow,
  unsendCutoff,
  unsendWindowExpiredError,
} from './unsend-policy';

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class MessagingCoreService {
  /**
   * Short-lived in-process cache: publicId/actId → internalUUID.
   * Conversation IDs are immutable after creation, so a 30s TTL is safe.
   * This eliminates 1–3 DB queries from every messaging endpoint call.
   * Modelled on Discord's conversation ID resolution layer.
   */
  private readonly convIdCache = new Map<
    string,
    { id: string; expiresAt: number }
  >();
  private static readonly CONV_CACHE_TTL_MS = 30_000;
  // Named distinctly from subclasses' own `logger` field (MessagesService
  // declares `protected readonly logger`) — a private/protected name clash
  // across the extends chain breaks TS's structural compatibility check.
  private readonly coreLogger = new Logger('MessagingCoreService');

  constructor(
    protected prisma: PrismaService,
    protected presenceService: PresenceService,
    protected domainEventService: DomainEventService,
    protected mentionsService: MentionsService,
    // Required, not optional: every block rule this class enforces runs through
    // it, so an unwired instance must fail at boot rather than quietly stop
    // filtering.
    protected blocksService: BlocksService,
    // Also required. This is the only thing standing between an unverified
    // account and a message insert on the socket path, which has no guard of
    // its own — an optional dependency would let that protection vanish
    // silently instead of failing at boot.
    protected verificationAccess: VerificationAccessService,
    // Required for the same reason as the two above: the send rate limit runs
    // through it on every path, and an optional dependency would let that
    // protection disappear silently instead of failing at boot.
    protected rateLimit: RateLimitService,
  ) {}

  /**
   * Measures attachments that did not come through a conversation upload (see
   * StorageService.assertMessageAttachmentWithinLimits). Property-injected so
   * the DM, group and socket services that extend this class all get it
   * without each re-declaring a constructor parameter; UploadsModule is global.
   */
  @Optional()
  @Inject(StorageService)
  protected readonly attachmentStorage?: StorageService;

  /**
   * Verification gate for a conversation that already exists.
   *
   * Called from every write path rather than from the controllers, because
   * the controllers are not the only entry point: `message:send` arrives over
   * Socket.IO, offline queues replay long after the composer was rendered, and
   * a stale tab still holds a conversation id it was allowed to open an hour
   * ago. Putting the check here means none of those bypass it.
   */
  protected async assertVerifiedForConversation(
    realConvId: string,
    senderId: string,
  ): Promise<void> {
    if (!this.verificationAccess.isEnforcementEnabled()) return;

    const conv = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: {
        type: true,
        participants: {
          where: { leftAt: null },
          select: { userId: true },
        },
      },
    });
    if (!conv) return; // the caller's own not-found handling owns this case

    const participantIds = conv.participants.map((p) => p.userId);
    await this.verificationAccess.assertCanMessageInConversation(
      realConvId,
      senderId,
      participantIds,
      conv.type === 'GROUP',
    );
  }

  /**
   * Joining a group is messaging, so the joiner must pass the selfie gate.
   * `@VerifiedOnly()` covers the HTTP routes; this covers every other caller
   * of the join path (and any route that forgets the decorator).
   */
  protected async assertMayJoinGroup(userId: string): Promise<void> {
    if (!this.verificationAccess.isEnforcementEnabled()) return;
    if (await this.verificationAccess.isUserEligible(userId)) return;
    throw verificationRequiredException();
  }

  /**
   * Approving a join request adds the requester as a member, so the requester
   * must be eligible at approval time — a request may have been made before
   * the selfie gate covered invite joins, or the account may have lapsed since.
   * An ineligible requester's request is removed so it stops showing to admins.
   * The wording is the neutral one `assertUsersEligible` uses for a
   * counterparty: it does not disclose the requester's verification state.
   */
  protected async assertJoinRequesterEligible(
    realConvId: string,
    targetUserId: string,
  ): Promise<void> {
    if (!this.verificationAccess.isEnforcementEnabled()) return;
    const ineligible = await this.verificationAccess.getIneligibleUserIds([
      targetUserId,
    ]);
    if (ineligible.length === 0) return;
    await this.prisma.conversationJoinRequest
      .delete({
        where: {
          conversationId_userId: {
            conversationId: realConvId,
            userId: targetUserId,
          },
        },
      })
      // Already gone (declined or expired concurrently): the refusal stands.
      .catch(() => undefined);
    throw new ForbiddenException({
      statusCode: 403,
      code: 'JOIN_REQUEST_INELIGIBLE',
      message:
        'This user is not available for messaging. Their request was removed.',
    });
  }

  async getBatchUnblockedAndUnmutedParticipants(
    conversationId: string,
    senderId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, deletedAt: null },
      select: { userId: true, isMuted: true },
    });

    const otherIds = participants
      .map((p) => p.userId)
      .filter((id) => id !== senderId);
    if (otherIds.length === 0) {
      return { recipientIds: [], unmutedRecipientIds: [] };
    }

    // Blocked pairs are dropped from the fan-out in both directions.
    const unblockedIds = await this.blocksService.filterBlockedUsers(
      senderId,
      otherIds,
    );
    const muteMap = new Map(participants.map((p) => [p.userId, p.isMuted]));
    const unmutedIds = unblockedIds.filter((id) => !muteMap.get(id));

    return { recipientIds: unblockedIds, unmutedRecipientIds: unmutedIds };
  }

  async resolveConversationId(
    identifier: string,
    currentUserId?: string,
  ): Promise<string> {
    if (!identifier) return identifier;
    const cleanId = String(identifier).replace(/^(act_)+/, '');

    // Fast path: return cached mapping if still fresh
    const cached =
      this.convIdCache.get(identifier) ?? this.convIdCache.get(cleanId);
    if (cached && cached.expiresAt > Date.now()) return cached.id;

    const cacheResult = (id: string) => {
      const entry = {
        id,
        expiresAt: Date.now() + MessagingCoreService.CONV_CACHE_TTL_MS,
      };
      this.convIdCache.set(identifier, entry);
      if (cleanId !== identifier) this.convIdCache.set(cleanId, entry);
      // Prevent unbounded growth: prune when over 2 000 entries
      if (this.convIdCache.size > 2000) {
        const now = Date.now();
        for (const [k, v] of this.convIdCache) {
          if (v.expiresAt <= now) this.convIdCache.delete(k);
          if (this.convIdCache.size <= 1000) break;
        }
      }
    };

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        cleanId,
      );

    try {
      let conv = null;
      if (isUuid) {
        conv = await this.prisma.conversation.findUnique({
          where: { id: cleanId },
          select: { id: true },
        });
      } else {
        conv = await this.prisma.conversation.findUnique({
          where: { publicId: cleanId },
          select: { id: true },
        });
      }

      if (conv?.id) {
        cacheResult(conv.id);
        return conv.id;
      }

      if (currentUserId && identifier !== currentUserId) {
        const dm = await this.prisma.conversation.findFirst({
          where: {
            type: 'DM',
            AND: [
              { participants: { some: { userId: currentUserId } } },
              { participants: { some: { userId: identifier } } },
            ],
          },
          select: { id: true },
        });
        if (dm?.id) {
          cacheResult(dm.id);
          return dm.id;
        }
      }
    } catch {
      // ignore transient errors, return identifier as-is
    }
    return identifier;
  }

  /**
   * The Redis service subclasses lock sends with. This class is not given one
   * itself; each service that inherits `sendMessage` returns its own.
   */
  protected sendLockService(): RedisService | undefined {
    return undefined;
  }

  /**
   * Sends a message, once per client message id.
   *
   * The DM and group-chat REST routes land here, and a retried send used to
   * insert a second copy every time: this path neither looked for nor stored
   * `clientMessageId`, unlike the socket path in MessagesService. Both now do,
   * under a per-id lock so two copies arriving together cannot both insert.
   */
  async sendMessage(
    senderId: string,
    conversationId: string,
    payload: SendMessageDto,
  ): Promise<
    MessageResponseDto & {
      recipientIds: string[];
      unmutedRecipientIds: string[];
      conversationName: string;
    }
  > {
    return withClientSendLock(
      this.sendLockService(),
      senderId,
      clientMessageIdOf(payload),
      () =>
        retryOnClientIdConflict(() =>
          this.sendMessageOnce(senderId, conversationId, payload),
        ),
    );
  }

  private async sendMessageOnce(
    senderId: string,
    conversationId: string,
    payload: SendMessageDto,
  ): Promise<
    MessageResponseDto & {
      recipientIds: string[];
      unmutedRecipientIds: string[];
      conversationName: string;
    }
  > {
    // The DM and group-chat services inherit this method, so the limit has to
    // be here as well as in MessagesService. See message-limits.ts.
    assertMessageTextWithinLimit(payload?.text);
    // Same for the attachment size: a key from outside a conversation folder
    // was never measured against the Messages limits.
    if (payload?.mediaUrl) {
      await this.attachmentStorage?.assertMessageAttachmentWithinLimits(
        payload.mediaUrl,
      );
    }

    const realConvId = await this.resolveConversationId(
      conversationId,
      senderId,
    );

    // After the id is resolved against this sender, so a 429 cannot be used to
    // probe whether a conversation exists. See message-limits.ts.
    await assertSendWithinRateLimit(this.rateLimit, senderId, realConvId);

    // 1. Fetch conversation details & active participants in a single query
    const conv = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: {
        id: true,
        publicId: true,
        name: true,
        type: true,
        participants: {
          // `deletedAt` is deliberately NOT filtered here. A participant who
          // deleted this conversation is still a member of it — they simply
          // hid it. New activity brings it back (see the revive below), so
          // they must stay in the recipient set; filtering them out silently
          // dropped every message sent to someone who had ever cleared the
          // thread. `leftAt` is different: that user really is gone.
          where: { leftAt: null },
          select: {
            userId: true,
            isMuted: true,
            // Who has it hidden: they join its rooms as it comes back.
            deletedAt: true,
            // The recipients' lifecycle state travels with the participant set
            // so the unavailability gate below costs no extra query.
            user: { select: { accountStatus: true, deletedAt: true } },
          },
        },
      },
    });

    if (!conv) {
      throw new ForbiddenException('Conversation not found');
    }

    // A retry of a send that already landed returns the original and does
    // none of the side effects below a second time. Looked up BEFORE the
    // refusals below: if the thread has closed since (blocked, left, partner
    // deleted), the message the recipient already has must not be reported
    // "Not delivered". Scoped to this sender, so it only finds their own row.
    const clientMsgId = clientMessageIdOf(payload);
    const existing = clientMsgId
      ? await this.prisma.message.findFirst({
          // The same scope as the unique index, (senderId, clientMessageId):
          // matching on the conversation too missed a reused id in another
          // chat, whose insert then failed on the index every time.
          where: { senderId, clientMessageId: clientMsgId },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
                accountStatus: true,
                deletedAt: true,
              },
            },
            replyTo: { select: REPLY_TO_SELECT },
          },
        })
      : null;
    // A client id already used for a message in ANOTHER conversation is a
    // client bug, not a retry: refuse it (REJECTED, so it is not retried).
    if (existing && existing.conversationId !== realConvId) {
      throw new BadRequestException('Message id already used');
    }

    const myParticipant = conv.participants.find((p) => p.userId === senderId);
    if (!existing && !myParticipant) {
      throw notAMemberError();
    }

    const otherParticipants = conv.participants.filter(
      (p) => p.userId !== senderId,
    );

    // ── Unavailable-recipient gate ────────────────────────────────────────
    // This is the enforcement, not the disabled composer on the client. Every
    // transport funnels through this method — REST, the socket `message:send`
    // handler, offline replay, attachment sends, reply actions — so a client
    // that removed the disabled state, or one calling the API directly, is
    // refused at the same point.
    //
    // A 1:1 thread with a deleted partner is closed for writes. The history
    // stays readable (that is the whole point: it is the OTHER person's
    // conversation too), but nothing new can be added to a thread whose only
    // other participant no longer exists to read it.
    const unavailableOthers = otherParticipants.filter((p) =>
      isUnavailableUser(p.user),
    );
    const isDirect = otherParticipants.length === 1;

    if (!existing && isDirect && unavailableOthers.length === 1) {
      throw new ForbiddenException({
        code: 'RECIPIENT_UNAVAILABLE',
        message: 'This user is no longer available.',
      });
    }

    // Verification gate, on the same participant set we just loaded. A DM
    // needs both people eligible; a group needs the sender. This sits below
    // every transport — REST, socket, offline replay — so a client holding
    // stale "you may type here" state is refused at the insert, not trusted.
    if (!existing) {
      await this.verificationAccess.assertCanMessageInConversation(
        conv.id,
        senderId,
        conv.participants.map((p) => p.userId),
        conv.type === 'GROUP',
      );
    }

    // In a group the conversation stays open — the other members are still
    // there — but a deleted member is dropped from the recipient set so no
    // notification, unread bump or delivery is generated for an account that
    // will never read it.
    const unavailableIds = new Set(unavailableOthers.map((p) => p.userId));
    const otherUserIds = otherParticipants
      .map((p) => p.userId)
      .filter((id) => !unavailableIds.has(id));
    const participantIdSet = new Set(conv.participants.map((p) => p.userId));

    // Mentions are a group feature (see message-mentions.ts). Re-derived from
    // the actual text and restricted to members, so tagging someone outside
    // the group never sends them a notification quoting a thread they cannot
    // see; `@everyone` counts only where the text really says it.
    const isGroupChat = conv.type === 'GROUP';
    const everyone = isGroupChat
      ? everyoneSpan(payload.text || '', payload.mentions)
      : null;
    const namedMentions = isGroupChat
      ? (
          await this.mentionsService.sanitize(
            payload.text || '',
            peopleMentions(payload.mentions),
            senderId,
          )
        ).filter((m) => participantIdSet.has(m.userId))
      : [];
    const sanitizedMentions = storedMentions(namedMentions, everyone);

    let recipientIds: string[] = [];
    let unmutedRecipientIds: string[] = [];

    if (otherUserIds.length > 0) {
      const excluded = new Set(
        await this.blocksService.getExcludedUserIds(senderId),
      );
      const blockedByMe = new Set(
        await this.blocksService.getBlockedByUserIds(senderId),
      );
      const blockedUserSet = new Set(
        otherUserIds.filter((id) => excluded.has(id)),
      );
      const isBlockedByMe = otherUserIds.some((id) => blockedByMe.has(id));
      const isBlockedByThem = otherUserIds.some(
        (id) => blockedUserSet.has(id) && !blockedByMe.has(id),
      );

      if (!existing && isBlockedByMe) {
        throw new ForbiddenException(
          'You blocked this user. Unblock them to continue messaging.',
        );
      }

      // See MessagesService.sendMessage: a 1:1 thread with a block in either
      // direction is closed for writes rather than silently swallowing the
      // message. Neutral wording, shared with restricted/limited accounts, so
      // the 403 does not disclose a block.
      const isOneToOne = otherUserIds.length === 1;
      if (!existing && isBlockedByThem && isOneToOne) {
        throw new ForbiddenException(
          'You can no longer send messages to this user.',
        );
      }

      recipientIds = otherUserIds.filter((id) => !blockedUserSet.has(id));
      const muteMap = new Map(
        conv.participants.map((p) => [p.userId, p.isMuted]),
      );
      unmutedRecipientIds = recipientIds.filter((id) => !muteMap.get(id));
    }

    const type =
      payload.mediaUrl || payload.mediaType
        ? ('MEDIA' as const)
        : ('CHAT' as const);

    let validatedReplyToId: string | null = null;
    if (payload.replyToId) {
      const replyTarget = await this.prisma.message.findFirst({
        where: {
          id: payload.replyToId,
          conversationId: realConvId,
        },
        select: { id: true },
      });
      validatedReplyToId = replyTarget ? replyTarget.id : null;
    }

    const initialInviteData = withInviteExpiry(
      storableInviteData(payload.inviteData),
    );

    const now = new Date();
    // The list preview, from the one table every path uses (message-preview.ts).
    const lastMsgText = previewText({
      type,
      payload: {
        text: payload.text,
        mediaUrl: payload.mediaUrl,
        mediaType: payload.mediaType,
        inviteData: initialInviteData,
      },
    });

    // 2. Atomic $transaction for message creation and conversation metadata
    // updates. The id is chosen here so the conversation row can point at it
    // (`lastMessageId`): this path used to leave that column on an older
    // message, so unsending the latest one never cleared the list preview.
    const newMessageId = randomUUID();
    const [message] = existing
      ? [existing]
      : await this.prisma
          .$transaction([
            this.prisma.message.create({
              data: {
                id: newMessageId,
                // The same instant as the conversation's lastMessageAt below,
                // so the list row and the message agree on when it was sent.
                createdAt: now,
                clientMessageId: clientMsgId,
                conversationId: realConvId,
                senderId,
                type,
                replyToId: validatedReplyToId,
                payload: {
                  // Coerced, not `|| ''`: `payload` is unvalidated client JSON, so a
                  // non-string here would be written straight into the Json column
                  // and later break every consumer that assumes a string.
                  text: asString(payload.text),
                  mediaUrl: asStringOrNull(payload.mediaUrl),
                  mediaType: asStringOrNull(payload.mediaType),
                  // Lightweight media metadata for instant, layout-stable rendering on
                  // the recipient side (thumbnail/poster + intrinsic dimensions/duration).
                  thumbnailUrl: asStringOrNull(payload.thumbnailUrl),
                  width: asNumberOrNull(payload.width),
                  height: asNumberOrNull(payload.height),
                  duration: asNumberOrNull(payload.duration),
                  mentions: sanitizedMentions,
                  // Client JSON (the DTO checks only that it is an object); proven
                  // to be JSON before it is written, rather than asserted.
                  inviteData: isJsonValue(initialInviteData)
                    ? initialInviteData
                    : null,
                  isForwarded: asBoolean(payload.isForwarded),
                  forwardedFromMessageId: asStringOrNull(
                    payload.forwardedFromMessageId,
                  ),
                },
              },
              include: {
                sender: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatar: true,
                    // Required by `presentUserName`/`presentUserAvatar` below. A
                    // select that omits these silently renders the real identity of
                    // a deleted sender, which is the exact leak this is here to stop.
                    accountStatus: true,
                    deletedAt: true,
                  },
                },
                replyTo: { select: REPLY_TO_SELECT },
              },
            }),
            this.prisma.conversation.update({
              where: { id: realConvId },
              data: {
                updatedAt: now,
                lastMessageId: newMessageId,
                lastMessageText: lastMsgText,
                lastMessageType: type,
                lastMessageAt: now,
                lastMessageSenderId: senderId,
              },
            }),
            // The membership check above ran before this transaction. The
            // conversation row is now locked (the update just above), and a
            // removal takes the same lock first (markParticipantLeft), so this
            // re-check sees any removal that committed while the send was in
            // flight: the update matches no row, Prisma throws P2025 and the
            // whole send rolls back. It writes `deletedAt: null` because sending
            // into a thread you had hidden brings it back for you anyway.
            this.prisma.conversationParticipant.update({
              where: {
                userId_conversationId: {
                  userId: senderId,
                  conversationId: realConvId,
                },
                leftAt: null,
              },
              data: { deletedAt: null },
            }),
            ...(otherUserIds.length > 0
              ? [
                  this.prisma.conversationParticipant.updateMany({
                    where: {
                      conversationId: realConvId,
                      userId: { not: senderId },
                      leftAt: null,
                    },
                    data: { unreadCount: { increment: 1 } },
                  }),
                ]
              : []),
            // New activity revives the conversation for anyone who had deleted it —
            // sender included, since sending into a thread you deleted is an
            // unambiguous request to have it back. `clearedAt` is deliberately left
            // alone: the thread returns, its old messages do not.
            this.prisma.conversationParticipant.updateMany({
              where: {
                conversationId: realConvId,
                leftAt: null,
                deletedAt: { not: null },
              },
              data: { deletedAt: null },
            }),
          ])
          .catch((err: unknown) => {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2025'
            ) {
              throw notAMemberError();
            }
            throw err;
          });

    const isUnsent = message.state === 'UNSENT';
    const msgPayload = payloadFields(message.payload);
    const outputInviteData = withInviteExpiry(
      isUnsent ? null : msgPayload.inviteData,
      message.createdAt,
    );

    const replyToObj = message.replyTo
      ? buildReplyToSnapshot(message.replyTo, senderId)
      : null;

    const pubId = conv.publicId || conversationId;

    if (!existing) {
      announceRevived(
        this.domainEventService,
        {
          conversationId: pubId,
          publicId: conv.publicId,
          internalId: realConvId,
        },
        revivedMemberIds(conv.participants),
      );
    }

    // Fire-and-forget: must never add latency to message delivery, and a
    // notification failure must never roll back the already-committed message.
    // Notified: the tagged members (or everyone), never anyone who muted it.
    const mentionTargets = mentionNotifyIds({
      named: namedMentions.map((m) => m.userId),
      everyone: Boolean(everyone),
      recipientIds,
      unmutedRecipientIds,
    });
    if (!existing && mentionTargets.length > 0 && message.sender && !isUnsent) {
      this.mentionsService
        .persistAndNotify({
          mentions: mentionTargets.map((userId) => ({
            userId,
            username: '',
            start: 0,
            end: 0,
          })),
          sourceType: MentionSource.MESSAGE,
          sourceId: message.id,
          actor: message.sender,
          entityType: NotificationEntityType.MESSAGE,
          entityId: pubId,
          contextText: payload.text || '',
          extraMetadata: {
            conversationId: pubId,
            internalConversationId: realConvId,
            // Lets an unsend find and clear this notification's quote.
            messageId: message.id,
          },
        })
        .catch((err) =>
          this.coreLogger.warn('Failed to process message mentions', err),
        );
    }

    return {
      id: message.id,
      conversationId: pubId,
      publicId: pubId,
      internalId: realConvId,
      senderId: message.senderId,
      senderName: presentUserName(message.sender),
      senderAvatar: presentUserAvatar(message.sender) || '',
      createdAt: message.createdAt,
      timestamp: message.createdAt,
      time: new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      type: message.type ? message.type.toLowerCase() : 'chat',
      state: message.state || 'SENT',
      isUnsent,
      payload: isUnsent
        ? { text: 'This message was unsent' }
        : message.payload || {},
      text: isUnsent
        ? 'This message was unsent'
        : stringOrEmpty(msgPayload.text),
      mediaUrl: isUnsent ? null : stringOrNull(msgPayload.mediaUrl),
      mediaType: isUnsent ? null : stringOrNull(msgPayload.mediaType),
      mentions: isUnsent ? [] : arrayOrEmpty(msgPayload.mentions),
      inviteData: outputInviteData,
      replyTo: isUnsent ? null : replyToObj,
      status: 'sent',
      // Empty for a retry of a send that already landed: the controllers fan
      // a send out to these (socket events and push notifications), and the
      // original send already did, so a retry must reach no one again.
      recipientIds: existing ? [] : recipientIds,
      unmutedRecipientIds: existing ? [] : unmutedRecipientIds,
      conversationName: conv.name || '',
    };
  }

  async getConversationHistory(
    conversationId: string,
    currentUserId?: string,
    beforeCursor?: string,
    limit: number = 50,
  ) {
    const realConvId = await this.resolveConversationId(
      conversationId,
      currentUserId,
    );
    let clearedAt: Date | null = null;
    const whereCondition: Prisma.MessageWhereInput = {
      conversationId: realConvId,
      deletedAt: null,
    };
    // Bounds on createdAt from three independent sources (the viewer leaving,
    // clearing the chat, and the page cursor), merged into one filter.
    const createdAtFilter: Prisma.DateTimeFilter<'Message'> = {};

    const [deletedForUser, participant, participants, historyConv] =
      await Promise.all([
        currentUserId
          ? this.prisma.deletedMessage.findMany({
              where: {
                userId: currentUserId,
                message: { conversationId: realConvId },
              },
              select: { messageId: true },
            })
          : Promise.resolve([]),
        currentUserId
          ? this.prisma.conversationParticipant.findFirst({
              where: {
                userId: currentUserId,
                conversationId: realConvId,
                deletedAt: null,
              },
            })
          : Promise.resolve(null),
        this.prisma.conversationParticipant.findMany({
          where: { conversationId: realConvId, deletedAt: null },
          select: {
            userId: true,
            lastReadAt: true,
            user: { select: { settings: { select: { readReceipts: true } } } },
          },
        }),
        this.prisma.conversation.findUnique({
          where: { id: realConvId },
          select: { type: true, isInstantMatch: true },
        }),
      ]);

    // Membership gate. A caller holding a conversation id or publicId is not
    // thereby allowed to read it: they must be a current participant. A former
    // member (leftAt set, row not deleted) still passes — they keep the history
    // up to the moment they left, bounded by leftAt below.
    if (!currentUserId || !participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    // Instant Match history is authorised by the live match session, which only
    // MessagesService can ask. DM and group endpoints never serve it.
    if (
      historyConv &&
      (historyConv.type === 'INSTANT_MATCH' || historyConv.isInstantMatch)
    ) {
      return {
        messages: [],
        canSendMessages: false,
        isMember: false,
        membershipChangedAt: null,
        participants: [],
        nextCursor: null,
      };
    }

    if (deletedForUser && deletedForUser.length > 0) {
      whereCondition.id = { notIn: deletedForUser.map((d) => d.messageId) };
    }

    if (participant) {
      clearedAt = participant.clearedAt;
      const pLeftAt = participant.leftAt;
      if (pLeftAt) {
        createdAtFilter.lte = pLeftAt;
      }
    }

    // Conversation history is deliberately NOT filtered by block.
    //
    // Blocking closes a thread for writes; it does not rewrite what was already
    // said. Both sides keep the full history, read-only. Filtering the blocked
    // party's messages out left the blocker looking at a one-sided transcript
    // of their own replies, with the other half of the conversation silently
    // missing — and in a group it tore holes in a shared thread for a block
    // nobody else was party to.
    //
    // Read-only is enforced on the write path (sendMessage rejects both
    // directions) and surfaced in the composer, not by hiding rows here.

    if (clearedAt) {
      createdAtFilter.gt = clearedAt;
    }

    const orConditions: Prisma.MessageWhereInput[] = [];

    if (typeof beforeCursor === 'string' && beforeCursor) {
      let cursorDate: Date | null = null;
      let cursorId: string | null = null;

      // Fast path: timestamp|id cursor — pure index seek, no DB lookup
      if (beforeCursor.includes('|')) {
        const [dateStr, idPart] = beforeCursor.split('|');
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          cursorDate = parsed;
          cursorId = idPart || null;
        }
      }

      if (!cursorDate) {
        const cursorMessage = await this.prisma.message.findUnique({
          where: { id: beforeCursor },
          select: { id: true, createdAt: true },
        });
        if (cursorMessage) {
          cursorDate = cursorMessage.createdAt;
          cursorId = cursorMessage.id;
        }
      }

      if (cursorDate) {
        if (cursorId) {
          orConditions.push({
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: cursorId } },
            ],
          });
        } else {
          createdAtFilter.lt = cursorDate;
        }
      }
    }

    if (Object.keys(createdAtFilter).length > 0) {
      whereCondition.createdAt = createdAtFilter;
    }
    if (orConditions.length > 0) {
      whereCondition.AND = orConditions;
    }

    const messages = await this.prisma.message.findMany({
      where: whereCondition,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            accountStatus: true,
            deletedAt: true,
          },
        },
        replyTo: { select: REPLY_TO_SELECT },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }
    messages.reverse();
    const realDbMessages = messages.filter((m) => !m.id.startsWith('sys_'));
    const oldestRealMessage = realDbMessages[0];
    // Use timestamp|id cursor so the server can seek with a pure index scan
    // (no findUnique DB lookup per page). Matches MessagesService format.
    const nextCursor =
      hasMore && oldestRealMessage
        ? oldestRealMessage.createdAt
          ? `${new Date(oldestRealMessage.createdAt).toISOString()}|${oldestRealMessage.id}`
          : oldestRealMessage.id
        : null;
    const otherParticipants = participants.filter(
      (p) => currentUserId && p.userId !== currentUserId,
    );
    const otherReadTimestamps = otherParticipants
      .filter(
        (p) => p.user?.settings?.readReceipts !== false && p.lastReadAt != null,
      )
      .map((p) => new Date(p.lastReadAt!).getTime());

    const isAllRead =
      otherReadTimestamps.length > 0 &&
      otherReadTimestamps.length === otherParticipants.length;
    const minOtherLastReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;

    const messagesMapped = messages.map((m) => {
      const payload = m.payload || {};
      const fields = payloadFields(payload);

      const replyToObj = m.replyTo
        ? buildReplyToSnapshot(m.replyTo, currentUserId)
        : null;

      const isRead =
        currentUserId &&
        m.senderId === currentUserId &&
        isAllRead &&
        minOtherLastReadAt + 5000 >= new Date(m.createdAt).getTime();
      const isUnsent = m.state === 'UNSENT';

      const inviteData = withInviteExpiry(
        isUnsent ? null : fields.inviteData,
        m.createdAt,
      );

      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: presentUserName(m.sender),
        senderAvatar: presentUserAvatar(m.sender) || '',
        from: currentUserId && m.senderId === currentUserId ? 'me' : 'them',
        createdAt: m.createdAt,
        timestamp: m.createdAt,
        time: m.createdAt
          ? new Date(m.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        type: m.type ? m.type.toLowerCase() : 'chat',
        payload: isUnsent ? { text: 'This message was unsent' } : payload,
        text: isUnsent ? 'This message was unsent' : stringOrEmpty(fields.text),
        mediaUrl: isUnsent ? null : stringOrNull(fields.mediaUrl),
        mediaType: isUnsent ? null : stringOrNull(fields.mediaType),
        mentions: isUnsent ? [] : arrayOrEmpty(fields.mentions),
        inviteData,
        replyTo: isUnsent ? null : replyToObj,
        status: isRead ? 'read' : 'sent',
        state: m.state || 'SENT',
        isUnsent,
      };
    });

    return {
      messages: messagesMapped,
      // Same verdict the /api/messages history carries: whether this viewer may
      // send here, from the policy the write path enforces with. It travels on
      // history because history is the one response every open thread fetches —
      // the conversation list only covers its first page, so a deep-linked
      // thread had no other way to learn the answer before trying to send.
      // A former member reads history up to when they left, and may not write.
      canSendMessages:
        currentUserId && !participant.leftAt
          ? await this.assertVerifiedForConversation(realConvId, currentUserId)
              .then(() => true)
              .catch(() => false)
          : false,
      // The viewer's membership as the server has it now, for a client whose
      // cached copy may be older (see membershipStamp in the frontend).
      isMember: !participant.leftAt,
      membershipChangedAt: membershipChangedAt(participant),
      // Not to a former member: the roster (who is in the group now, and when
      // each last read) is the group's, not theirs any more. Their client
      // counted it as the member count in the chat's header.
      participants: participant.leftAt
        ? []
        : participants.map((p) => ({
            userId: p.userId,
            lastReadAt:
              p.user?.settings?.readReceipts !== false ? p.lastReadAt : null,
          })),
      nextCursor,
    };
  }

  /**
   * Write-behind read receipt (WhatsApp/Slack pattern): acknowledge instantly,
   * do the DB write + fan-out to OTHER participants in setImmediate so the
   * caller's response is never blocked on it. Shared by all three messaging
   * services (DM / group / unified) so every read endpoint is equally fast and
   * correctly notifies the other side.
   */
  markAsRead(
    conversationId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    setImmediate(() => void this._persistMarkAsRead(conversationId, userId));
    return Promise.resolve({ success: true });
  }

  protected async _persistMarkAsRead(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    try {
      const realConvId = await this.resolveConversationId(
        conversationId,
        userId,
      );

      const conv = await this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { id: true, publicId: true },
      });
      if (!conv) return;

      const now = new Date();
      // Update only an existing, active participant. An upsert here used to
      // create the row, so POST /:id/read made any caller a member of any
      // conversation they could name. A non-participant matches nothing and
      // the whole receipt (including the fan-out below) is dropped.
      const updated = await this.prisma.conversationParticipant.updateMany({
        where: {
          userId,
          conversationId: realConvId,
          deletedAt: null,
          leftAt: null,
        },
        data: { lastReadAt: now, unreadCount: 0 },
      });
      if (updated.count === 0) return;

      // The reader's own devices. Reading on one used to leave the chat's
      // unread badge on every other one until its list happened to refetch:
      // the `conversation:seen` below is for the OTHER participants (read
      // receipts) and is skipped entirely when receipts are off. This goes to
      // the reader's personal room whatever their receipt setting, carries the
      // server's time of the read so a device can tell whether a message
      // arrived after it, and the list cache is dropped so a refetch agrees.
      const publicId = conv.publicId || conv.id;
      void this.domainEventService.emit(
        'conversation:read',
        {
          conversationId: publicId,
          publicId,
          internalId: realConvId,
          readAt: now.toISOString(),
        },
        [userId],
      );
      void this.invalidateUserConversationsCache([userId]).catch(() => {});

      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, deletedAt: null },
        select: {
          userId: true,
          lastReadAt: true,
          user: { select: { settings: { select: { readReceipts: true } } } },
        },
      });

      const readerParticipant = participants.find((p) => p.userId === userId);
      if (readerParticipant?.user?.settings?.readReceipts === false) return;

      for (const p of participants) {
        if (p.userId === userId) continue;
        const others = participants.filter((item) => item.userId !== p.userId);
        const otherReadTimestamps = others
          .filter(
            (item) =>
              item.user?.settings?.readReceipts !== false &&
              item.lastReadAt != null,
          )
          .map((item) => new Date(item.lastReadAt!).getTime());

        const isAllRead =
          otherReadTimestamps.length > 0 &&
          otherReadTimestamps.length === others.length;
        const minOtherReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;

        void this.domainEventService.emit(
          'conversation:seen',
          {
            conversationId,
            realConvId,
            readerId: userId,
            lastReadAt: now.toISOString(),
            isAllRead,
            minOtherReadAt: minOtherReadAt
              ? new Date(minOtherReadAt).toISOString()
              : null,
          },
          [p.userId],
        );
      }
    } catch (err) {
      this.coreLogger.warn(
        `markAsRead background write failed: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * The caller must be an ACTIVE participant (not left, not removed) of the
   * conversation. Every refusal is the same 403 so a stranger cannot use the
   * response to learn whether a message id exists.
   */
  protected async assertActiveParticipant(
    conversationId: string,
    userId: string,
    options: { allowLeft?: boolean } = {},
  ): Promise<void> {
    const row = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        deletedAt: null,
        ...(options.allowLeft ? {} : { leftAt: null }),
      },
      select: { userId: true },
    });
    if (!row) {
      throw notAMemberError('Not a member of this conversation');
    }
  }

  async reactToMessage(messageId: string, userId: string, reaction: string) {
    // A reaction is a message-composer action too, so it obeys the same rule
    // as sending: emoji on a thread you are not allowed to write in would be
    // a trivial way to keep talking to someone you cannot message.
    const target = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        conversationId: true,
        conversation: { select: { type: true } },
      },
    });
    if (!target) {
      throw new NotFoundException('Message not found');
    }
    await this.assertActiveParticipant(target.conversationId, userId);
    if (target.conversation?.type === 'DM') {
      const others = await this.prisma.conversationParticipant.findMany({
        where: {
          conversationId: target.conversationId,
          userId: { not: userId },
          deletedAt: null,
        },
        select: { userId: true },
      });
      for (const other of others) {
        if (await this.blocksService.isBlocked(userId, other.userId)) {
          throw new ForbiddenException(
            'You can no longer react to messages from this user.',
          );
        }
      }
    }
    await this.assertVerifiedForConversation(target.conversationId, userId);

    await this.prisma.messageReaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji: reaction,
        },
      },
      update: {},
      create: {
        messageId,
        userId,
        emoji: reaction,
      },
    });
    return { success: true };
  }

  /**
   * Unsend: the sender takes back their own message, for everyone.
   *
   * Allowed only to the message's sender, only while they are still in the
   * conversation, and only within UNSEND_WINDOW_MS of when the server accepted
   * the message (unsend-policy.ts). The window is enforced by the write itself
   * — a conditional update on `createdAt` against the server's clock — so a
   * request that passes the read and loses a race with the deadline, or one
   * from a client whose clock is wrong, still cannot unsend late.
   *
   * Idempotent: unsending a message that is already unsent succeeds with
   * `changed: false`, and the controllers announce nothing a second time.
   *
   * Everything that could still show the original goes with it: the payload
   * (text, media, invite, mentions), the reply link, the conversation's list
   * preview when this was the latest message, and the quoted snippet in any
   * mention notification it caused. Media stops being served at once: access
   * to a chat attachment is granted only through a message that still names it
   * and is not unsent (StorageService.canViewConversationMedia).
   */
  async unsendMessage(messageId: string, userId: string) {
    const now = new Date();
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        createdAt: true,
        state: true,
        type: true,
        payload: true,
        conversation: {
          select: {
            id: true,
            publicId: true,
            lastMessageId: true,
            lastMessageAt: true,
            lastMessageSenderId: true,
            // Every row, filtered below against this message's own time: the
            // sender's membership and who may still have it on screen are both
            // read from this one query.
            participants: { select: { userId: true, leftAt: true } },
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only unsend your own messages');
    }

    // "X removed Y from the group" is authored by X but is not X's to retract.
    if (message.type === 'SYSTEM') {
      throw new ForbiddenException('This message cannot be unsent');
    }

    const participants = message.conversation?.participants ?? [];
    const sender = participants.find((p) => p.userId === userId);
    if (!sender || sender.leftAt) {
      throw notAMemberError();
    }

    const publicId = message.conversation?.publicId || message.conversationId;
    // Everyone who could have this message on screen or in a cache: current
    // members, and anyone who left after it was sent (their history still
    // shows it, up to when they left).
    const audience = () =>
      participants
        .filter((p) => !p.leftAt || p.leftAt >= message.createdAt)
        .map((p) => p.userId);
    const result = (
      changed: boolean,
      participantIds: string[] = [],
      wasLatest = false,
    ) => ({
      success: true,
      changed,
      id: message.id,
      messageId: message.id,
      conversationId: message.conversationId,
      publicId,
      participantIds,
      // Whether it was the conversation's latest message: only then does any
      // list preview change, and only then is that announced.
      wasLatest,
      createdAt: message.createdAt,
      senderId: message.senderId,
      state: 'UNSENT' as const,
    });

    if (message.state === 'UNSENT') return result(false);

    if (!isWithinUnsendWindow(message.createdAt, now)) {
      throw unsendWindowExpiredError();
    }

    const updated = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        senderId: userId,
        state: { not: 'UNSENT' },
        createdAt: { gte: unsendCutoff(now) },
      },
      data: {
        state: 'UNSENT',
        replyToId: null,
        payload: {
          text: 'This message was unsent',
          mediaUrl: null,
          mediaType: null,
          inviteData: null,
          isForwarded: false,
        },
      },
    });

    if (updated.count === 0) {
      // Lost a race: either another request unsent it first (fine, same
      // outcome) or the window closed between the read and the write.
      const current = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { state: true },
      });
      if (current?.state === 'UNSENT') return result(false);
      throw unsendWindowExpiredError();
    }

    const wasLatest = await this.clearListPreviewIfLatest(message, userId);

    const mentions = arrayOrEmpty(payloadFields(message.payload).mentions);
    if (mentions.length > 0) {
      await this.scrubMentionNotifications(messageId, userId, publicId);
    }

    return result(true, audience(), wasLatest);
  }

  /**
   * The list preview is the conversation's own copy of the latest message;
   * once that message is unsent the preview says so. Matched on the id where
   * it was recorded; otherwise (a row written before every send path recorded
   * it) the message is the latest when nothing in the conversation is newer.
   * The write is conditional on the preview still being the one read, so a
   * message that arrives in between keeps its own preview.
   */
  private async clearListPreviewIfLatest(
    message: {
      id: string;
      conversationId: string;
      createdAt: Date;
      conversation: {
        lastMessageId: string | null;
        lastMessageAt: Date | null;
        lastMessageSenderId: string | null;
      } | null;
    },
    userId: string,
  ): Promise<boolean> {
    const conv = message.conversation;
    if (!conv) return false;
    const byId = conv.lastMessageId === message.id;
    const byTime =
      !byId &&
      conv.lastMessageSenderId === userId &&
      conv.lastMessageAt !== null &&
      !(await this.prisma.message.findFirst({
        where: {
          conversationId: message.conversationId,
          createdAt: { gt: message.createdAt },
        },
        select: { id: true },
      }));
    if (!byId && !byTime) return false;
    const updated = await this.prisma.conversation
      .updateMany({
        where: byId
          ? { id: message.conversationId, lastMessageId: message.id }
          : {
              id: message.conversationId,
              lastMessageAt: conv.lastMessageAt ?? undefined,
              lastMessageSenderId: userId,
            },
        data: {
          lastMessageText: UNSENT_PREVIEW,
          lastMessageType: 'CHAT',
        },
      })
      .catch(() => ({ count: 0 }));
    return updated.count > 0;
  }

  /**
   * A mention notification quotes the start of the message that caused it.
   * Once that message is unsent the quote goes too; the notification itself
   * stays ("X mentioned you."), so unread counts are not disturbed. Recipients
   * holding the list open are told the row changed. Best effort: the message
   * itself is already unsent, and a failure here must not report otherwise.
   *
   * Found through the message's own Mention rows (indexed on source), then by
   * the notification's unique key (recipient, actor, conversation, type), so
   * it never scans the notification table. A notification that has since been
   * reused for a newer mention in the same conversation names that newer
   * message and is left alone.
   */
  private async scrubMentionNotifications(
    messageId: string,
    actorId: string,
    conversationPublicId: string,
  ): Promise<void> {
    try {
      const mentioned = await this.prisma.mention.findMany({
        where: { sourceType: MentionSource.MESSAGE, sourceId: messageId },
        select: { userId: true },
      });
      if (mentioned.length === 0) return;
      const rows = await this.prisma.notification.findMany({
        where: {
          recipientId: { in: mentioned.map((m) => m.userId) },
          actorId,
          entityId: conversationPublicId,
          type: 'MENTION',
        },
        select: { id: true, recipientId: true, metadata: true },
      });
      for (const row of rows) {
        const metadata: Prisma.JsonObject = isJsonObject(row.metadata)
          ? row.metadata
          : {};
        if (metadata.messageId !== messageId) continue;
        const next = await this.prisma.notification.update({
          where: { id: row.id },
          data: { metadata: { ...metadata, contextText: '' } },
        });
        void this.domainEventService.emit('notification:updated', next, [
          row.recipientId,
        ]);
      }
    } catch (err) {
      this.coreLogger.warn(
        `Could not clear mention previews for an unsent message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async deleteMessageForMe(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.assertActiveParticipant(message.conversationId, userId);

    await this.prisma.deletedMessage.upsert({
      where: { userId_messageId: { userId, messageId } },
      create: { userId, messageId },
      update: {},
    });
    // The list preview skips messages deleted for this viewer (viewer-preview.ts),
    // so a cached list from before this may show the one just deleted.
    void this.invalidateUserConversationsCache([userId]).catch(() => {});

    return {
      success: true,
      messageId: message.id,
      conversationId: message.conversationId,
    };
  }

  /**
   * The source message of a forward, only if the caller could read it.
   *
   * A forward copies a message's text and media into another conversation, so
   * being allowed to forward it is being allowed to read it. This used to look the
   * message up by id and nothing else: anyone who held (or guessed) a message id
   * could copy a private message into their own chat, whatever conversation it
   * belonged to.
   *
   * The caller must be an ACTIVE member of the message's own conversation, and
   * the message must be inside their read window - the same window history uses:
   * after they cleared the chat, up to when they left, not deleted for them, not
   * deleted or unsent, and not a system line.
   *
   * Every refusal is the same "not found". Telling an outsider "that message
   * exists but is not yours" would confirm that an id is real.
   */
  protected async getForwardableMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        createdAt: true,
        deletedAt: true,
        state: true,
        type: true,
        payload: true,
      },
    });
    if (
      !message ||
      message.deletedAt !== null ||
      message.state === 'UNSENT' ||
      message.type === 'SYSTEM'
    ) {
      throw new NotFoundException('Message not found');
    }

    const [participant, deletedForUser] = await Promise.all([
      this.prisma.conversationParticipant.findFirst({
        where: {
          userId,
          conversationId: message.conversationId,
          deletedAt: null,
        },
        select: { clearedAt: true, leftAt: true },
      }),
      this.prisma.deletedMessage.findFirst({
        where: { userId, messageId },
        select: { id: true },
      }),
    ]);

    if (
      !participant ||
      deletedForUser ||
      (participant.clearedAt && message.createdAt <= participant.clearedAt) ||
      (participant.leftAt && message.createdAt > participant.leftAt)
    ) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  async forwardMessage(
    messageId: string,
    targetConversationIds: string[],
    userId: string,
  ) {
    // One point per destination — a forward carries a list, so charging per
    // call would fan a message out to many conversations for the price of one.
    await assertForwardWithinRateLimit(
      this.rateLimit,
      userId,
      targetConversationIds,
    );

    const originalMsg = await this.getForwardableMessage(messageId, userId);

    const payload = payloadFields(originalMsg.payload);
    const text = stringOrEmpty(payload.text);
    const mediaUrl = stringOrNull(payload.mediaUrl);
    const mediaType = stringOrNull(payload.mediaType);

    const forwarded: Awaited<
      ReturnType<MessagingCoreService['sendMessage']>
    >[] = [];
    const chunkSize = 5;
    for (let i = 0; i < targetConversationIds.length; i += chunkSize) {
      const chunk = targetConversationIds.slice(i, i + chunkSize);

      const promises = chunk.map(async (targetId) => {
        const realConvId = await this.resolveConversationId(targetId);
        const isParticipant =
          await this.prisma.conversationParticipant.findFirst({
            where: { userId, conversationId: realConvId, deletedAt: null },
          });
        if (!isParticipant) return null;

        return this.sendMessage(userId, realConvId, {
          text,
          // sendMessage treats null and undefined alike (truthiness and
          // asStringOrNull); its DTO spells "absent" as undefined.
          mediaUrl: mediaUrl ?? undefined,
          mediaType: mediaType ?? undefined,
          replyToId: undefined,
          mentions: [],
          isForwarded: true,
          forwardedFromMessageId: messageId,
        });
      });

      const results = await Promise.all(promises);
      results.forEach((msg) => {
        if (msg) forwarded.push(msg);
      });
    }

    return { success: true, count: forwarded.length, messages: forwarded };
  }

  /**
   * Cache-busting hook for the per-user conversation list.
   *
   * The four per-user conversation actions below (mute, pin, clear, delete)
   * all change what `getUserConversations` should return, and that result is
   * Redis-cached per user. Without this the optimistic UI update is correct
   * for a moment and then snaps back the instant anything refetches the list
   * and gets served the pre-action cache entry.
   *
   * Declared as a no-op here and overridden by the subclasses that own a Redis
   * client (MessagesService, GroupChatsService); DmService has no list cache
   * of its own and inherits the no-op.
   */
  async invalidateUserConversationsCache(_userIds?: string[]): Promise<void> {
    /* no-op — see subclass overrides */
  }

  /**
   * Per-user conversation-membership writes.
   *
   * All four actions below are deliberately `updateMany` rather than `update`:
   * `updateMany` matches zero rows without throwing, which makes every one of
   * them idempotent. A double-tap, an offline retry, or a request that races
   * a "leave group" all resolve to the same end state instead of a P2025
   * surfacing as a 500 to a user who already saw the UI change.
   *
   * Each is a single indexed write against one small membership row — no
   * joins, no cascades, no aggregate recomputation — so the round trip stays
   * short even before optimistic UI hides it.
   */
  async muteConversation(
    conversationId: string,
    userId: string,
    muted: boolean,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const { count } = await this.prisma.conversationParticipant.updateMany({
      where: { userId, conversationId: realConvId },
      data: { isMuted: muted },
    });
    this.invalidateUserConversationsCache([userId]).catch(() => {});
    if (count > 0) this.announceOwnPrefs(userId, realConvId, { muted });
    return { success: true, muted };
  }

  /**
   * A per-user preference of a conversation (mute, pin) changed: the user's
   * other devices take it now. They used to keep the old state until their
   * list happened to refetch, so a chat muted on the phone still raised
   * alerts and badges on the laptop.
   */
  private announceOwnPrefs(
    userId: string,
    realConvId: string,
    prefs: { muted?: boolean; pinned?: boolean; pinnedAt?: string | null },
  ): void {
    void this.domainEventService.emit(
      'conversation:prefs',
      { conversationId: realConvId, internalId: realConvId, ...prefs },
      [userId],
    );
  }

  /**
   * `pinnedAt` is stamped alongside `isPinned` so the list can order pinned
   * chats by when they were pinned rather than by last activity — otherwise a
   * newly pinned chat lands wherever its last message happens to put it, which
   * reads as the pin not having worked. Unpinning clears it so a stale
   * timestamp can never outlive the flag.
   */
  async pinConversation(
    conversationId: string,
    userId: string,
    pinned: boolean,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const pinnedAt = pinned ? new Date() : null;
    const { count } = await this.prisma.conversationParticipant.updateMany({
      where: { userId, conversationId: realConvId },
      data: { isPinned: pinned, pinnedAt },
    });
    this.invalidateUserConversationsCache([userId]).catch(() => {});
    if (count > 0) {
      this.announceOwnPrefs(userId, realConvId, {
        pinned,
        pinnedAt: pinnedAt ? pinnedAt.toISOString() : null,
      });
    }
    return { success: true, pinned };
  }

  /**
   * Clear leaves the conversation in the list and only moves the per-user
   * history watermark. Every read path that serves message content for a user
   * — history, and the media gallery derived from it — filters on `clearedAt`,
   * so the clear survives new messages arriving: they are after the watermark,
   * the old ones stay behind it forever.
   */
  async clearChatForUser(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const clearedAt = new Date();
    await this.prisma.conversationParticipant.updateMany({
      where: { userId, conversationId: realConvId },
      data: { clearedAt },
    });
    this.invalidateUserConversationsCache([userId]).catch(() => {});
    return { success: true, clearedAt };
  }

  /**
   * Delete a conversation for one participant only.
   *
   * `clearedAt` moves with `deletedAt`, and that is the whole fix for history
   * coming back. Deleting only hid the row; the moment the conversation was
   * revived — by this user messaging the same person again, which resets
   * `deletedAt` — the history query had no watermark to filter against and
   * served every message the user thought they had deleted. Stamping
   * `clearedAt` at the same instant means the revived conversation starts
   * empty and stays that way.
   *
   * Both columns are per-participant, so the other user's row, their history
   * and their copy of the conversation are untouched.
   */
  async deleteConversationForUser(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const now = new Date();
    await this.prisma.conversationParticipant.updateMany({
      where: { userId, conversationId: realConvId },
      data: { deletedAt: now, clearedAt: now },
    });
    this.invalidateUserConversationsCache([userId]).catch(() => {});
    return { success: true, deletedAt: now, clearedAt: now };
  }

  // ─── Canonical group role/ownership operations ─────────────────────────────
  // Single source of truth shared by MessagesService and GroupChatsService
  // (both extend this base). Each validates the actor's authority AND that the
  // target is an active member, so a bad targetUserId yields a clean 404 rather
  // than a raw Prisma "record not found" 500.

  async changeGroupOwner(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const [participant, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
      }),
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId: targetUserId,
            conversationId: realConvId,
          },
        },
      }),
    ]);
    assertGroupAuthority(
      participant,
      ['OWNER'],
      'Only the owner can transfer ownership',
    );
    if (!target || target.leftAt || target.deletedAt) {
      throw new NotFoundException('Target user is not a member of this group');
    }
    // The conversation row first: a send locks it before any participant row
    // (sendMessageOnce), so taking them in the other order could deadlock.
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: realConvId },
        data: { ownerId: targetUserId },
      }),
      this.prisma.conversationParticipant.update({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
        data: { role: 'ADMIN' },
      }),
      this.prisma.conversationParticipant.update({
        where: {
          userId_conversationId: {
            userId: targetUserId,
            conversationId: realConvId,
          },
        },
        data: { role: 'OWNER' },
      }),
    ]);
    return { success: true };
  }

  async promoteToAdmin(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const [participant, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
      }),
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId: targetUserId,
            conversationId: realConvId,
          },
        },
      }),
    ]);
    assertGroupAuthority(
      participant,
      ['OWNER'],
      'Only the owner can promote admins',
    );
    if (!target || target.leftAt || target.deletedAt) {
      throw new NotFoundException('Target user is not a member of this group');
    }
    await this.prisma.conversationParticipant.update({
      where: {
        userId_conversationId: {
          userId: targetUserId,
          conversationId: realConvId,
        },
      },
      data: { role: 'ADMIN' },
    });
    // Whether someone reviews join requests is part of what details shows them.
    await this.invalidateGroupDetailsVersion(realConvId).catch(() => {});
    return { success: true };
  }

  async demoteFromAdmin(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const [participant, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
      }),
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId: targetUserId,
            conversationId: realConvId,
          },
        },
      }),
    ]);
    assertGroupAuthority(
      participant,
      ['OWNER'],
      'Only the owner can demote admins',
    );
    if (!target || target.leftAt || target.deletedAt) {
      throw new NotFoundException('Target user is not a member of this group');
    }
    await this.prisma.conversationParticipant.update({
      where: {
        userId_conversationId: {
          userId: targetUserId,
          conversationId: realConvId,
        },
      },
      data: { role: 'MEMBER' },
    });
    // Whether someone reviews join requests is part of what details shows them.
    await this.invalidateGroupDetailsVersion(realConvId).catch(() => {});
    return { success: true };
  }

  async endGroup(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });
    assertGroupAuthority(
      participant,
      ['OWNER'],
      'Only the owner can end the group',
    );
    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { status: 'Closed' },
    });
    return { success: true };
  }

  async addGroupMember(
    conversationId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    await assertGroupConversation(this.prisma, realConvId);
    const [participant, conv] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId: requesterId,
            conversationId: realConvId,
          },
        },
      }),
      this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { status: true },
      }),
    ]);
    // An active member: a row alone is not enough, since removing or leaving
    // keeps it (with `leftAt` set) — and the upsert below clears `leftAt`, so
    // a removed member could otherwise add themselves straight back.
    if (!isActiveParticipant(participant)) {
      throw new ForbiddenException('Not a member of this conversation');
    }
    // A group that has ended takes no one new, however they arrive (joining,
    // an approved request, an invite).
    if (this.isConversationClosed(conv?.status)) {
      throw new BadRequestException('GROUP_CLOSED');
    }

    // Both sides of an add must be eligible: the member doing the adding, and
    // the account being pulled in. Same neutral wording as the block refusal
    // above, so the caller learns nothing about the target's status.
    await this.verificationAccess.assertUsersEligible(
      [requesterId, targetUserId],
      requesterId,
    );

    // Block enforcement: don't let a member pull someone they've blocked (or who
    // blocked them) into a shared group.
    if (await this.blocksService.isBlocked(requesterId, targetUserId)) {
      // Neutral by design. The earlier wording named the block relationship
      // outright and so disclosed it to the caller. The reason is withheld
      // here, exactly as it is on every other blocked surface.
      throw new ForbiddenException(
        'This user is not available to add to the group.',
      );
    }

    // Someone already in the group is left exactly as they are. The upsert
    // resets the role to MEMBER, so "adding" the owner or an admin used to
    // demote them.
    const existing = await this.prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId: targetUserId,
          conversationId: realConvId,
        },
      },
      select: { leftAt: true, deletedAt: true },
    });
    if (isActiveParticipant(existing)) {
      return { success: true, alreadyMember: true };
    }

    const joinedAt = new Date();
    await this.prisma.conversationParticipant.upsert({
      where: {
        userId_conversationId: {
          userId: targetUserId,
          conversationId: realConvId,
        },
      },
      update: {
        leftAt: null,
        deletedAt: null,
        joinedAt,
        role: 'MEMBER',
        ...CLEARED_LEFT_SNAPSHOT,
      },
      create: {
        userId: targetUserId,
        conversationId: realConvId,
        role: 'MEMBER',
        joinedAt,
      },
    });
    await this.evictMembershipCaches(realConvId, [targetUserId]);

    return {
      success: true,
      alreadyMember: false,
      joinedAt: joinedAt.toISOString(),
      internalId: realConvId,
    };
  }

  async removeGroupMember(
    conversationId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    await assertGroupConversation(this.prisma, realConvId);

    const [requester, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId: requesterId,
            conversationId: realConvId,
          },
        },
      }),
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId: targetUserId,
            conversationId: realConvId,
          },
        },
      }),
    ]);

    assertGroupAuthority(
      requester,
      ['OWNER', 'ADMIN'],
      'Only group admins can remove members',
    );

    // Already removed (a repeated request, or another admin got there first):
    // the outcome the caller asked for, with nothing to announce again.
    if (target && target.leftAt) {
      return {
        success: true,
        changed: false,
        leftAt: target.leftAt.toISOString(),
        internalId: realConvId,
        publicId: realConvId,
      };
    }

    // `deletedAt` only means the member hid the chat; they are still in the
    // group and can be removed from it.
    if (!target) {
      throw new NotFoundException('Member not found in group');
    }

    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the group owner');
    }

    if (requester?.role === 'ADMIN' && target.role === 'ADMIN') {
      throw new ForbiddenException(
        'Admins cannot remove other admins. Only the owner can remove admins.',
      );
    }

    const { changed, leftAt, publicId } = await markParticipantLeft(
      this.prisma,
      realConvId,
      targetUserId,
    );
    await this.evictMembershipCaches(realConvId, [targetUserId]);

    return {
      success: true,
      changed,
      leftAt: leftAt.toISOString(),
      internalId: realConvId,
      publicId: publicId || realConvId,
    };
  }

  /**
   * After a membership change, every cached copy that describes it.
   *
   * The conversation list is cached per viewer (60s) and carries `isMember`
   * and the member count. The client refetches it the moment the removal
   * event lands; without this eviction that refetch was answered from the
   * cache with the pre-removal row, and wrote `isMember: true` straight back
   * over the event's patch — the removed user's composer came back, and stayed
   * until the entry expired or the app restarted. The remaining members' rows
   * carry the count, so theirs go too.
   */
  async evictMembershipCaches(
    realConvId: string,
    alsoUserIds: string[] = [],
  ): Promise<void> {
    const members = await this.prisma.conversationParticipant
      .findMany({
        where: { conversationId: realConvId, leftAt: null },
        select: { userId: true },
      })
      .catch(() => [] as { userId: string }[]);
    await Promise.all([
      this.invalidateUserConversationsCache([
        ...new Set([...alsoUserIds, ...members.map((m) => m.userId)]),
      ]),
      this.invalidateGroupDetailsVersion(realConvId),
    ]);
  }

  async leaveGroup(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    await assertGroupConversation(this.prisma, realConvId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });

    // Leaving is idempotent; a member who only hid the chat can still leave.
    if (!participant || participant.leftAt) {
      return { success: true, changed: false };
    }

    const { changed, leftAt, publicId } = await markParticipantLeft(
      this.prisma,
      realConvId,
      userId,
    );
    if (!changed) return { success: true, changed: false };

    if (participant.role === 'OWNER') {
      const oldestAdmin = await this.prisma.conversationParticipant.findFirst({
        where: {
          conversationId: realConvId,
          deletedAt: null,
          leftAt: null,
          role: 'ADMIN',
        },
        orderBy: { joinedAt: 'asc' },
      });

      // The conversation row first, as every other multi-row write here does,
      // so this cannot deadlock against a send (see markParticipantLeft).
      if (oldestAdmin) {
        await this.prisma.$transaction([
          this.prisma.conversation.update({
            where: { id: realConvId },
            data: { ownerId: oldestAdmin.userId },
          }),
          this.prisma.conversationParticipant.update({
            where: {
              userId_conversationId: {
                userId: oldestAdmin.userId,
                conversationId: realConvId,
              },
            },
            data: { role: 'OWNER' },
          }),
        ]);
      } else {
        const oldestMember =
          await this.prisma.conversationParticipant.findFirst({
            where: {
              conversationId: realConvId,
              deletedAt: null,
              leftAt: null,
              userId: { not: userId },
            },
            orderBy: { joinedAt: 'asc' },
          });

        if (oldestMember) {
          await this.prisma.$transaction([
            this.prisma.conversation.update({
              where: { id: realConvId },
              data: { ownerId: oldestMember.userId },
            }),
            this.prisma.conversationParticipant.update({
              where: {
                userId_conversationId: {
                  userId: oldestMember.userId,
                  conversationId: realConvId,
                },
              },
              data: { role: 'OWNER' },
            }),
          ]);
        } else {
          await this.prisma.conversation.update({
            where: { id: realConvId },
            data: { status: 'Closed' },
          });
        }
      }
    }

    await this.evictMembershipCaches(realConvId, [userId]);
    return {
      success: true,
      changed: true,
      leftAt: leftAt.toISOString(),
      internalId: realConvId,
      publicId: publicId || realConvId,
    };
  }

  /**
   * Evicts the group-details cache for a conversation. A no-op here: the
   * service that owns that cache (GroupChatsService) overrides it.
   */
  protected async invalidateGroupDetailsVersion(
    _realConvId: string,
  ): Promise<void> {
    /* no-op — see subclass override */
  }

  async createSystemMessage(
    conversationId: string,
    senderId: string,
    text: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    // The actor must belong to the conversation. A just-departed member is
    // allowed because "<handle> left the group" is posted after leftAt is set.
    await this.assertActiveParticipant(realConvId, senderId, {
      allowLeft: true,
    });
    const message = await this.prisma.message.create({
      data: {
        conversationId: realConvId,
        senderId,
        type: 'SYSTEM',
        payload: { text },
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            accountStatus: true,
            deletedAt: true,
          },
        },
      },
    });

    // The denormalised last-message columns move with it. Bumping only
    // `updatedAt` left the conversation list previewing the message *before*
    // the system message: the socket patch showed the new line, then the next
    // refetch of ['conversations'] read these columns and reverted it.
    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: {
        updatedAt: message.createdAt,
        lastMessageText: text,
        lastMessageType: 'SYSTEM',
        lastMessageAt: message.createdAt,
        lastMessageSenderId: senderId,
      },
    });

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      // Keeps the original 'System' fallback for an authorless system event;
      // a real author still resolves through the presenter, so a deleted one
      // renders as "Deleted User" here too.
      senderName: message.sender ? presentUserName(message.sender) : 'System',
      senderAvatar: presentUserAvatar(message.sender) || '',
      createdAt: message.createdAt,
      timestamp: message.createdAt,
      time: new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      type: 'system',
      payload: { text },
      text,
      status: 'sent',
    };
  }

  async getConversationParticipantIds(
    conversationId: string,
  ): Promise<string[]> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId: realConvId,
        leftAt: null,
        deletedAt: null,
      },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }

  async getGroupUpdatesParticipantIds(
    conversationId: string,
  ): Promise<string[]> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId: realConvId,
        leftAt: null,
        deletedAt: null,
        groupUpdatesActive: true,
      },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }

  async getConversationById(conversationId: string) {
    const realId = await this.resolveConversationId(conversationId);
    return this.prisma.conversation.findUnique({
      where: { id: realId },
      include: {
        avatarMedia: true,
      },
    });
  }

  async getUserHandle(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });
    if (!user) return 'Someone';
    const rawName = user.username || user.displayName || 'Someone';
    return rawName.startsWith('@') ? rawName : `@${rawName}`;
  }

  async isUserConversationMuted(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      select: { isMuted: true },
    });
    return participant?.isMuted || false;
  }

  // ─── Group invites ─────────────────────────────────────────────────────────
  //
  // Both MessagesService and GroupChatsService expose the invite endpoints, so
  // the logic lives here once. Previously each subclass carried its own copy of
  // requestGroupJoin and they had already started to drift.

  /** Canonical join policy. Older rows carry legacy spellings for APPROVAL. */
  private normalizeWhoCanJoin(
    raw: string | null | undefined,
  ): 'ANYONE' | 'APPROVAL' {
    const v = (raw || 'ANYONE').toUpperCase().replace(/[\s-]+/g, '_');
    if (
      v === 'APPROVAL' ||
      v === 'APPROVAL_REQUIRED' ||
      v === 'REQUEST_REQUIRED'
    ) {
      return 'APPROVAL';
    }
    return 'ANYONE';
  }

  /**
   * The card for inviting someone to `groupId`, built from the group as it is
   * now. Refuses an inviter who is no longer in the group, a closed group, and
   * a target who is already in it.
   *
   * The card used to be assembled by the client from whatever it had cached
   * and stored as given, so it could carry a stale (or invented) name, picture
   * or member count. The recipient's card reads the live preview anyway; this
   * makes what is stored true as well. Three reads, in parallel.
   */
  async buildGroupInvite(
    groupId: string,
    inviterId: string,
    targetUserId: string,
  ): Promise<Prisma.InputJsonObject> {
    const realConvId = await this.resolveConversationId(groupId);
    const [conv, rows, memberCount] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: realConvId, type: 'GROUP' },
        select: {
          id: true,
          publicId: true,
          name: true,
          avatarKey: true,
          description: true,
          whoCanJoin: true,
          status: true,
        },
      }),
      this.prisma.conversationParticipant.findMany({
        where: {
          conversationId: realConvId,
          userId: { in: [inviterId, targetUserId] },
        },
        select: { userId: true, leftAt: true, deletedAt: true },
      }),
      this.prisma.conversationParticipant.count({
        where: { conversationId: realConvId, leftAt: null, deletedAt: null },
      }),
    ]);
    if (!conv) throw new NotFoundException('GROUP_NOT_FOUND');
    const inviter = rows.find((r) => r.userId === inviterId);
    if (!inviter || inviter.leftAt) throw notAMemberError();
    if (this.isConversationClosed(conv.status)) {
      throw new ForbiddenException('GROUP_CLOSED');
    }
    const target = rows.find((r) => r.userId === targetUserId);
    if (target && !target.leftAt && !target.deletedAt) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'This person is already in the group.',
      });
    }
    const pubId = conv.publicId || conv.id;
    return {
      type: 'group_invite',
      groupId: pubId,
      conversationId: pubId,
      groupName: conv.name || 'Group',
      groupAvatar: conv.avatarKey || null,
      description: conv.description || '',
      whoCanJoin: this.normalizeWhoCanJoin(conv.whoCanJoin),
      memberCount,
    };
  }

  private isConversationClosed(status: string | null | undefined): boolean {
    const s = (status || '').toUpperCase();
    return (
      s === 'CLOSED' || s === 'ENDED' || s === 'CANCELLED' || s === 'EXPIRED'
    );
  }

  /**
   * Is this user barred from the group by a block? A block in EITHER direction
   * with the group's owner is disqualifying — joining would put two people who
   * blocked each other into the same room.
   */
  private async isBlockedFromGroup(
    ownerId: string | null | undefined,
    userId: string,
  ) {
    if (!ownerId || ownerId === userId) return false;
    try {
      return await this.blocksService.isBlocked(ownerId, userId);
    } catch {
      // A blocks-service outage must not silently open the gate, but it also
      // must not wedge every join. Treat it as "not blocked" and log.
      this.coreLogger.warn(
        `Block check failed for group join (owner=${ownerId}, user=${userId})`,
      );
      return false;
    }
  }

  /**
   * Everything the invite screen needs to decide what to render, for ANY
   * authenticated user — member or not. This is deliberately readable by
   * non-members: without it an invite link is a dead end, since getGroupDetails
   * and the history endpoint both require membership.
   *
   * It exposes only what an invite already reveals (name, avatar, description,
   * member count, join policy) and never the member list or any message.
   */
  async getGroupInvitePreview(conversationId: string, userId: string) {
    if (!conversationId) throw new NotFoundException('GROUP_NOT_FOUND');

    let realConvId: string;
    try {
      realConvId = await this.resolveConversationId(conversationId);
    } catch {
      throw new NotFoundException('GROUP_NOT_FOUND');
    }

    const conv = await this.prisma.conversation.findFirst({
      where: { id: realConvId, type: 'GROUP' },
      select: {
        id: true,
        publicId: true,
        name: true,
        avatarKey: true,
        description: true,
        ownerId: true,
        whoCanJoin: true,
        visibility: true,
        status: true,
        memberCount: true,
      },
    });
    if (!conv) throw new NotFoundException('GROUP_NOT_FOUND');

    const [participant, joinRequest, liveMemberCount] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId, conversationId: conv.id } },
        select: { role: true, leftAt: true, deletedAt: true },
      }),
      this.prisma.conversationJoinRequest.findUnique({
        where: { conversationId_userId: { conversationId: conv.id, userId } },
        select: { status: true, expiresAt: true },
      }),
      this.prisma.conversationParticipant.count({
        where: { conversationId: conv.id, leftAt: null, deletedAt: null },
      }),
    ]);

    const isMember = Boolean(
      participant && !participant.leftAt && !participant.deletedAt,
    );
    const whoCanJoin = this.normalizeWhoCanJoin(conv.whoCanJoin);
    const isClosed = this.isConversationClosed(conv.status);
    const requestActive = Boolean(
      joinRequest &&
      String(joinRequest.status).toUpperCase() === 'PENDING' &&
      (!joinRequest.expiresAt || joinRequest.expiresAt > new Date()),
    );
    const isBlocked = isMember
      ? false
      : await this.isBlockedFromGroup(conv.ownerId, userId);
    // Joining needs the selfie verification; the client shows the verify
    // prompt instead of a Join button that would answer 403. Cached lookup.
    const requiresVerification =
      !isMember &&
      this.verificationAccess.isEnforcementEnabled() &&
      !(await this.verificationAccess.isUserEligible(userId));

    // A single reason code the client switches on, instead of re-deriving the
    // same precedence from six separate fields.
    let joinState: string;
    if (isMember) joinState = 'MEMBER';
    else if (isClosed) joinState = 'CLOSED';
    else if (isBlocked) joinState = 'BLOCKED';
    else if (requestActive) joinState = 'REQUESTED';
    else if (whoCanJoin === 'APPROVAL') joinState = 'APPROVAL_REQUIRED';
    else joinState = 'CAN_JOIN';

    const pubId = conv.publicId || conv.id;
    return {
      id: pubId,
      publicId: pubId,
      internalId: conv.id,
      name: conv.name || 'Group',
      avatar: conv.avatarKey || null,
      avatarKey: conv.avatarKey || null,
      description: conv.description || null,
      memberCount: liveMemberCount || conv.memberCount || 0,
      whoCanJoin,
      visibility: conv.visibility || 'PUBLIC',
      status: conv.status || 'ACTIVE',
      isMember,
      myRole: isMember ? participant?.role || 'MEMBER' : null,
      hasPendingRequest: requestActive,
      joinState,
      requiresVerification,
    };
  }

  /**
   * Join (or request to join) a group. Idempotent and duplicate-safe: calling
   * it for an existing member is a no-op that reports JOINED, and the
   * participant row is written with an upsert keyed on (userId, conversationId)
   * so a double-tap or a retried request can never create a second membership.
   *
   * Returns { status: 'JOINED' | 'PENDING', … }; every refusal is an
   * exception carrying a stable machine-readable code.
   */
  async joinGroupByInvite(conversationId: string, userId: string) {
    if (!userId) throw new ForbiddenException('UNAUTHENTICATED');
    if (!conversationId) throw new NotFoundException('GROUP_NOT_FOUND');

    let realConvId: string;
    try {
      realConvId = await this.resolveConversationId(conversationId);
    } catch {
      throw new NotFoundException('GROUP_NOT_FOUND');
    }

    // The group and this user's row in it, in one round trip: accepting an
    // invite is a tap the person waits on, and these two reads used to run one
    // after the other.
    const [conversation, existing] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: realConvId, type: 'GROUP' },
        select: {
          id: true,
          publicId: true,
          name: true,
          ownerId: true,
          whoCanJoin: true,
          visibility: true,
          status: true,
        },
      }),
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
        select: { role: true, leftAt: true, deletedAt: true, joinedAt: true },
      }),
    ]);
    if (!conversation) throw new NotFoundException('GROUP_NOT_FOUND');

    const pubId = conversation.publicId || conversation.id;
    const identity = {
      conversationId: pubId,
      publicId: pubId,
      internalId: conversation.id,
    };

    // Already a member → succeed without touching the row. This is what makes
    // a re-tapped invite show "Already joined" instead of an error.
    if (existing && !existing.leftAt && !existing.deletedAt) {
      return {
        status: 'JOINED' as const,
        alreadyMember: true,
        role: existing.role,
        membershipChangedAt: membershipChangedAt(existing),
        ...identity,
      };
    }

    if (this.isConversationClosed(conversation.status)) {
      throw new BadRequestException('GROUP_CLOSED');
    }

    // Both joining and requesting to join are refused: a request from an
    // unverified account could never be approved (see acceptGroupJoinRequest).
    // The two checks are independent, so they run together.
    const [, blocked] = await Promise.all([
      this.assertMayJoinGroup(userId),
      this.isBlockedFromGroup(conversation.ownerId, userId),
    ]);
    if (blocked) {
      throw new ForbiddenException('BLOCKED');
    }

    const whoCanJoin = this.normalizeWhoCanJoin(conversation.whoCanJoin);

    if (whoCanJoin === 'ANYONE') {
      // The server's time of joining, returned so the client can order this
      // membership against any event about it that arrives late.
      const joinedAt = new Date();
      try {
        await this.prisma.conversationParticipant.upsert({
          where: {
            userId_conversationId: { userId, conversationId: conversation.id },
          },
          create: {
            userId,
            conversationId: conversation.id,
            role: 'MEMBER',
            joinedAt,
          },
          // Re-joining after leaving reuses the row and clears the tombstone
          // fields rather than inserting a duplicate.
          update: {
            leftAt: null,
            deletedAt: null,
            joinedAt,
            role: 'MEMBER',
            ...CLEARED_LEFT_SNAPSHOT,
          },
        });
      } catch (err) {
        // Two concurrent joins can both miss the findUnique above and race into
        // the upsert. The loser sees a unique-constraint violation, which here
        // means the membership exists — exactly the intended end state.
        const isDuplicate =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002';
        if (!isDuplicate) throw err;
      }

      // A stale request row would otherwise keep showing "Requested" to admins.
      // Not waited on: the membership above is what the caller asked for.
      void this.prisma.conversationJoinRequest
        .deleteMany({
          where: { conversationId: conversation.id, userId },
        })
        .catch(() => {});

      return {
        status: 'JOINED' as const,
        alreadyMember: false,
        role: 'MEMBER',
        membershipChangedAt: joinedAt.toISOString(),
        ...identity,
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    // Whether this is a request the admins have not seen: a re-tap on a
    // request still pending only renews it, and must not tell them again.
    const prior = await this.prisma.conversationJoinRequest.findUnique({
      where: {
        conversationId_userId: { conversationId: conversation.id, userId },
      },
      select: { status: true, expiresAt: true },
    });
    const newRequest =
      !prior ||
      prior.status !== 'PENDING' ||
      (prior.expiresAt !== null && prior.expiresAt <= now);
    await this.prisma.conversationJoinRequest.upsert({
      where: {
        conversationId_userId: { conversationId: conversation.id, userId },
      },
      create: {
        conversationId: conversation.id,
        userId,
        status: 'PENDING',
        expiresAt,
      },
      update: { status: 'PENDING', expiresAt },
    });
    // The admins' view of the group lists its requests.
    await this.invalidateGroupDetailsVersion(conversation.id).catch(() => {});

    return {
      status: 'PENDING' as const,
      alreadyMember: false,
      newRequest,
      expiresAt,
      ...identity,
    };
  }

  /** The group's owner and admins who are in it now: who reviews requests. */
  async getGroupReviewerIds(realConvId: string): Promise<string[]> {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId: realConvId,
        leftAt: null,
        deletedAt: null,
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /**
   * An admin approves a request to join.
   *
   * One copy, here: GroupChatsService and MessagesService each had their own,
   * identical, and both let a closed group take a new member, answered a
   * second admin's approval (or a double tap) with "Join request not found"
   * although the person was in, and announced the approval without the
   * group's two ids or the time of joining, so the new member's sockets joined
   * only one of the group's rooms and their clients could not order the event.
   *
   * @returns `changed: false` when the person is already in the group (an
   *   approval that already happened); nothing is announced for that.
   */
  async acceptGroupJoinRequest(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ): Promise<{
    success: true;
    changed: boolean;
    conversationId: string;
    publicId: string;
    internalId: string;
    membershipChangedAt: string | null;
  }> {
    const realConvId = await this.resolveConversationId(conversationId);
    const [participant, conv, target, joinRequest] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
      }),
      this.prisma.conversation.findFirst({
        where: { id: realConvId, type: 'GROUP' },
        select: { id: true, publicId: true, status: true },
      }),
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId: targetUserId,
            conversationId: realConvId,
          },
        },
        select: { leftAt: true, deletedAt: true, joinedAt: true },
      }),
      this.prisma.conversationJoinRequest.findUnique({
        where: {
          conversationId_userId: {
            conversationId: realConvId,
            userId: targetUserId,
          },
        },
        select: { expiresAt: true },
      }),
    ]);
    assertGroupAuthority(
      participant,
      ['OWNER', 'ADMIN'],
      'Only group admins can accept requests',
    );
    if (!conv) throw new NotFoundException('GROUP_NOT_FOUND');
    if (this.isConversationClosed(conv.status)) {
      throw new BadRequestException('GROUP_CLOSED');
    }
    const pubId = conv.publicId || conv.id;
    const identity = {
      conversationId: pubId,
      publicId: pubId,
      internalId: conv.id,
    };
    const dropRequest = () =>
      this.prisma.conversationJoinRequest.deleteMany({
        where: { conversationId: realConvId, userId: targetUserId },
      });

    if (isActiveParticipant(target)) {
      await dropRequest();
      return {
        success: true,
        changed: false,
        ...identity,
        membershipChangedAt: membershipChangedAt(target),
      };
    }
    if (!joinRequest) throw new NotFoundException('Join request not found');
    if (joinRequest.expiresAt && joinRequest.expiresAt < new Date()) {
      await dropRequest();
      throw new BadRequestException('Join request has expired');
    }

    // Approving adds a member: the approver and the requester must both pass
    // the selfie gate, exactly as for addMember.
    await this.assertMayJoinGroup(userId);
    await this.assertJoinRequesterEligible(realConvId, targetUserId);

    const joinedAt = new Date();
    await this.prisma.$transaction([
      dropRequest(),
      this.prisma.conversationParticipant.upsert({
        where: {
          userId_conversationId: {
            userId: targetUserId,
            conversationId: realConvId,
          },
        },
        update: {
          leftAt: null,
          deletedAt: null,
          joinedAt,
          role: 'MEMBER',
          ...CLEARED_LEFT_SNAPSHOT,
        },
        create: {
          userId: targetUserId,
          conversationId: realConvId,
          role: 'MEMBER',
          joinedAt,
        },
      }),
    ]);
    await this.evictMembershipCaches(realConvId, [targetUserId]);
    return {
      success: true,
      changed: true,
      ...identity,
      membershipChangedAt: joinedAt.toISOString(),
    };
  }

  /** An admin declines a request; `changed: false` when it was already gone. */
  async declineGroupJoinRequest(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ): Promise<{ success: true; changed: boolean; internalId: string }> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });
    assertGroupAuthority(
      participant,
      ['OWNER', 'ADMIN'],
      'Only group admins can decline requests',
    );
    const { count } = await this.prisma.conversationJoinRequest.deleteMany({
      where: { conversationId: realConvId, userId: targetUserId },
    });
    if (count > 0) {
      await this.invalidateGroupDetailsVersion(realConvId).catch(() => {});
    }
    return { success: true, changed: count > 0, internalId: realConvId };
  }

  /** Back-compat alias — both controllers and existing callers use this name. */
  async requestGroupJoin(conversationId: string, userId: string) {
    return this.joinGroupByInvite(conversationId, userId);
  }
}

/** The client's id for a send, under either name the clients have used. */
function clientMessageIdOf(payload: SendMessageDto): string | null {
  const id = payload?.clientId || payload?.tempId;
  return typeof id === 'string' && id ? id : null;
}
