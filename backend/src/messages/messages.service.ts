import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Optional,
} from '@nestjs/common';
import { Prisma, MentionSource, NotificationEntityType } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { generatePublicId } from '../common/utils/public-id.util';
import { LruCache } from '../common/utils/lru-cache.util';
import { MessagingCoreService } from './core/messaging-core.service';
import { SendMessageDto } from './core/dto/send-message.dto';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { resolvePresenceVisibilityForViewer } from '../users/privacy.helper';
import { MentionsService } from '../mentions/mentions.service';
import { buildReplyToSnapshot, REPLY_TO_SELECT } from './reply-preview.util';
import { MediaCleanupService } from '../uploads/media-cleanup.service';

/** The one question MessagesService asks the Instant Match domain. Kept to a
 *  single method so the coupling between the two stays visible and small. */
export interface InstantMatchChatGuard {
  assertCanSendInChat(userId: string, conversationId: string): Promise<void>;
}

@Injectable()
export class MessagesService
  extends MessagingCoreService
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Authorizes writes into an Instant Match chat.
   *
   * Late-bound rather than injected: InstantMatchModule already imports
   * MessagesModule (it needs `createInstantMatchConversation`), so a
   * constructor dependency the other way is a circular import. This mirrors
   * the `setRealtimeGatewayRef` pattern the gateway uses for the same reason.
   * InstantMatchService registers itself on init.
   */
  private instantMatchGuard: InstantMatchChatGuard | null = null;

  registerInstantMatchGuard(guard: InstantMatchChatGuard | null) {
    this.instantMatchGuard = guard;
  }

  private instantMatchCleanupTimer?: NodeJS.Timeout;
  protected readonly logger = new Logger(MessagesService.name);
  private handleCache = new LruCache<string, string>(5000, 3600000);
  private readonly redis: Redis | null;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly presenceService: PresenceService,
    protected readonly domainEventService: DomainEventService,
    mentionsService: MentionsService,
    // NOT @Optional: this service enforces the block rules on every send and
    // every conversation read. If it could go missing, block enforcement would
    // silently disappear with it rather than failing loudly at boot. Declared
    // without a modifier and handed to super(), so the single inherited
    // `blocksService` is the one everything uses — no shadowing copy. Ordered
    // before the optional param because a required parameter cannot follow one.
    blocksService: BlocksService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
  ) {
    super(
      prisma,
      presenceService,
      domainEventService,
      mentionsService,
      blocksService,
    );
    this.redis = this.redisService?.getClient() ?? null;
  }

  async invalidateUserConversationsCache(userIds?: string[]) {
    if (!this.redis) return;
    try {
      if (userIds && userIds.length > 0) {
        // H-3 fix: Construct keys directly from known user IDs — no SCAN needed.
        // The conversation list is paginated with limit/offset; we invalidate page 0
        // (the most common fetch) plus a few common limits to cover the UI variants.
        const COMMON_LIMITS = [20, 30, 50];
        const keysToDelete: string[] = [];
        for (const uId of userIds) {
          for (const lim of COMMON_LIMITS) {
            keysToDelete.push(`user:conversations:${uId}:${lim}:0`);
          }
        }
        if (keysToDelete.length > 0) {
          await this.redis.del(...keysToDelete);
        }
      } else {
        // Global flush — only called explicitly, not on message send.
        // Still uses SCAN but is now a deliberate, rare admin action.
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            'user:conversations:*',
            'COUNT',
            100,
          );
          cursor = nextCursor;
          if (keys && keys.length > 0) await this.redis.del(...keys);
        } while (cursor !== '0');
      }
    } catch {}
  }

  async onModuleInit() {
    await this.cleanupExpiredInstantMatches();
    // Every 5 minutes rather than 15: the sidebar shows a live countdown, so
    // a chat that lingers for up to a quarter of an hour past "expired" reads
    // as broken. Expiry is driven purely by `expiresAt`, which is stamped at
    // creation — it does not depend on any message ever being sent.
    this.instantMatchCleanupTimer = setInterval(
      () => void this.cleanupExpiredInstantMatches(),
      5 * 60 * 1000,
    );
    this.instantMatchCleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.instantMatchCleanupTimer)
      clearInterval(this.instantMatchCleanupTimer);
  }

  private async cleanupExpiredInstantMatches() {
    try {
      // Collect the affected participants *before* the delete cascades their
      // rows away — otherwise both users keep serving a cached conversation
      // list containing a chat that no longer exists, and tapping it 404s.
      const expiring = await this.prisma.conversation.findMany({
        where: { isInstantMatch: true, expiresAt: { lt: new Date() } },
        select: { id: true, participants: { select: { userId: true } } },
      });
      if (expiring.length === 0) return;

      await this.prisma.conversation.deleteMany({
        where: { id: { in: expiring.map((c) => c.id) } },
      });

      const affected = [
        ...new Set(
          expiring.flatMap((c) => c.participants.map((p) => p.userId)),
        ),
      ];
      await this.invalidateUserConversationsCache(affected).catch(() => {});
      this.logger.log(
        `instant-match cleanup: removed ${expiring.length} expired chat(s)`,
      );
    } catch (error) {
      this.logger.warn(
        `Expired instant-match cleanup failed: ${(error as Error).message}`,
      );
    }
  }

  private resolveCache = new Map<string, { id: string; timestamp: number }>();

  async resolveConversationId(
    identifier: string,
    currentUserId?: string,
  ): Promise<string> {
    if (!identifier) return identifier;
    const cleanId = String(identifier).replace(/^(act_)+/, '');

    const cacheKey = `${identifier}:${currentUserId || ''}`;
    const cached = this.resolveCache.get(cacheKey);
    // H-4 fix: TTL reduced from 24 hours → 5 minutes.
    // A 24h window meant stale mappings persisted for deleted/merged conversations,
    // causing ForbiddenException errors for up to a full day after a conversation changed.
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.id;
    }

    try {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          cleanId,
        );
      if (isUuid) {
        const directConv = await this.prisma.conversation.findUnique({
          where: { id: cleanId },
          select: { id: true },
        });
        if (directConv?.id) {
          this.resolveCache.set(cacheKey, {
            id: directConv.id,
            timestamp: Date.now(),
          });
          return directConv.id;
        }
      }

      // 2. Direct index lookup via publicId (@unique index scan: 0.01ms)
      const pubConv = await this.prisma.conversation.findUnique({
        where: { publicId: cleanId },
        select: { id: true },
      });
      if (pubConv?.id) {
        this.resolveCache.set(cacheKey, {
          id: pubConv.id,
          timestamp: Date.now(),
        });
        return pubConv.id;
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
          this.resolveCache.set(cacheKey, { id: dm.id, timestamp: Date.now() });
          return dm.id;
        }
      }
    } catch (err) {
      // ignore
    }
    return identifier;
  }

  async sendMessage(
    senderId: string,
    conversationId: string,
    payload: SendMessageDto,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);

    const conv = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: {
        id: true,
        publicId: true,
        name: true,
        type: true,
        isInstantMatch: true,
        participants: {
          where: { deletedAt: null, leftAt: null },
          select: { userId: true, isMuted: true },
        },
      },
    });

    if (!conv) {
      throw new ForbiddenException('Conversation not found');
    }

    // Instant Match chats are authorized against their match session, not
    // just against participation: a chat can be over — someone left, or the
    // 24h window closed — while both people are still participants. This is
    // the single choke point every client shares, so no route reaches a
    // message insert without it, and a stale tab is refused here rather than
    // being trusted to have disabled its own input.
    if (conv.type === 'INSTANT_MATCH' || conv.isInstantMatch) {
      if (!this.instantMatchGuard) {
        throw new ForbiddenException('This Instant Match chat is unavailable');
      }
      await this.instantMatchGuard.assertCanSendInChat(senderId, realConvId);
    }

    const convChatType: 'instant' | 'normal' =
      conv.type === 'INSTANT_MATCH' || conv.isInstantMatch
        ? 'instant'
        : 'normal';

    const senderParticipant = conv.participants.find(
      (p) => p.userId === senderId,
    );
    if (!senderParticipant) {
      throw new ForbiddenException(
        'You are no longer a member of this conversation',
      );
    }

    const otherUserIds = conv.participants
      .filter((p) => p.userId !== senderId)
      .map((p) => p.userId);
    let recipientIds: string[] = [];
    let unmutedRecipientIds: string[] = [];

    if (otherUserIds.length > 0) {
      const muteMap = new Map(
        conv.participants.map((p) => [p.userId, p.isMuted]),
      );

      // Fast path: the Redis-cached exclusion set (invalidated on every
      // block/unblock) tells us whether the sender has ANY block relationship
      // with a participant of this conversation. When there is no overlap, the
      // vast-majority case, we skip the Block table entirely.
      const excluded = new Set(
        await this.blocksService.getExcludedUserIds(senderId),
      );
      const hasOverlap = otherUserIds.some((id) => excluded.has(id));

      if (!hasOverlap) {
        // No block relationship with anyone in this conversation — the
        // overwhelmingly common case, and it costs one cached lookup.
        recipientIds = otherUserIds;
      } else {
        // Overlap: ask the service for the DIRECTION so we can tell "I blocked
        // them" apart from "they blocked me" — the two produce different
        // messages and, in a group, different fan-outs.
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

        if (isBlockedByMe) {
          throw new ForbiddenException(
            'You blocked this user. Unblock them to continue messaging.',
          );
        }

        // A 1:1 thread with a block in EITHER direction is closed for writes.
        // Previously the blocked sender's message was written and then delivered
        // to nobody — the client got a 200 and rendered a message that no one
        // would ever receive. Rejecting is both honest to the sender and cheaper
        // than storing undeliverable rows.
        //
        // The wording is deliberately the same neutral string used for
        // restricted and limited accounts, so a 403 here does not disclose that
        // a block specifically is what closed the thread.
        const isOneToOne = otherUserIds.length === 1;
        if (isBlockedByThem && isOneToOne) {
          throw new ForbiddenException(
            'You can no longer send messages to this user.',
          );
        }

        // Group threads stay writable: the message is still legitimately
        // delivered to every other participant, and only the blocked pair is
        // dropped from the recipient fan-out.
        recipientIds = otherUserIds.filter((id) => !blockedUserSet.has(id));
      }

      unmutedRecipientIds = recipientIds.filter((id) => !muteMap.get(id));
    }

    const type =
      payload.mediaUrl || payload.mediaType
        ? ('MEDIA' as const)
        : ('CHAT' as const);
    const participantIdSet = new Set(conv.participants.map((p) => p.userId));

    // Re-derive the true mention set from the actual message text, then
    // restrict it to real conversation participants — mentioning someone
    // outside the conversation must never leak a notification to a user with
    // no access to this thread.
    const sanitizedMentions = (
      await this.mentionsService.sanitize(
        payload.text || '',
        payload.mentions,
        senderId,
      )
    ).filter((m) => participantIdSet.has(m.userId));

    // 1. Idempotency Check
    const clientMsgId = (payload as any).clientId || (payload as any).tempId;
    if (clientMsgId) {
      // Idempotency: match on the indexed `clientMessageId` column (index
      // [senderId, clientMessageId]) instead of a JSON payload-path predicate.
      // The old `payload->>'tempId'` / `payload->>'clientId'` predicates could
      // not use any index and forced a filtered scan of the sender's messages
      // on every send. The column is written below (`clientMessageId: clientMsgId`).
      const existing = await this.prisma.message.findFirst({
        where: {
          senderId,
          conversationId: realConvId,
          clientMessageId: clientMsgId,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          replyTo: { select: REPLY_TO_SELECT },
        },
      });
      if (existing) {
        return this.formatMessageResponse(
          existing,
          realConvId,
          conversationId,
          senderId,
          clientMsgId,
          recipientIds,
          unmutedRecipientIds,
          conv.name || undefined,
          convChatType,
        );
      }
    }

    // 2. Resolve replyToId safely
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

    // Normalize group-invite expiry at write time so it is identical on every
    // send path (this MessagesService path + the DM/group core path). A group
    // invite defaults to a 48h TTL; isExpired is recomputed on read below.
    let initialInviteData = payload.inviteData || null;
    if (
      initialInviteData &&
      (initialInviteData.type === 'group_invite' ||
        initialInviteData.groupId ||
        initialInviteData.conversationId)
    ) {
      const expiresAt =
        initialInviteData.expiresAt ||
        new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      initialInviteData = {
        ...initialInviteData,
        expiresAt,
        isExpired: new Date(expiresAt).getTime() <= Date.now(),
      };
    }

    // 3. Transactional Write
    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          clientMessageId: clientMsgId || null,
          conversationId: realConvId,
          senderId,
          type,
          replyToId: validatedReplyToId,
          payload: {
            text: payload.text || '',
            mediaUrl: payload.mediaUrl || null,
            mediaType: payload.mediaType || null,
            // Lightweight media metadata for instant, layout-stable recipient rendering.
            thumbnailUrl: payload.thumbnailUrl || null,
            width: payload.width || null,
            height: payload.height || null,
            duration: payload.duration || null,
            mentions: sanitizedMentions,
            inviteData: initialInviteData,
            isForwarded: payload.isForwarded || false,
            forwardedFromMessageId: payload.forwardedFromMessageId || null,
            tempId: clientMsgId || null,
            clientId: clientMsgId || null,
          } as any,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          replyTo: { select: REPLY_TO_SELECT },
        },
      });

      await tx.conversation.update({
        where: { id: realConvId },
        data: {
          updatedAt: new Date(),
          lastMessageId: msg.id,
          lastMessageText:
            payload.text ||
            (payload.mediaUrl
              ? payload.mediaType === 'image'
                ? 'Photo'
                : payload.mediaType === 'video'
                  ? 'Video'
                  : 'Audio'
              : ''),
          lastMessageType: type,
          lastMessageAt: msg.createdAt,
          lastMessageSenderId: senderId,
        },
      });

      await tx.conversationParticipant.updateMany({
        where: {
          conversationId: realConvId,
          userId: { not: senderId },
          leftAt: null,
          deletedAt: null,
        },
        data: { unreadCount: { increment: 1 } },
      });

      return msg;
    });

    // Fire-and-forget: must never add latency to message delivery, and a
    // notification failure must never roll back the already-committed message.
    if (
      sanitizedMentions.length > 0 &&
      message.sender &&
      message.state !== 'UNSENT'
    ) {
      const pubId = conv.publicId || conversationId;
      this.mentionsService
        .persistAndNotify({
          mentions: sanitizedMentions,
          sourceType: MentionSource.MESSAGE,
          sourceId: message.id,
          actor: message.sender,
          entityType: NotificationEntityType.MESSAGE,
          entityId: pubId,
          contextText: payload.text || '',
          extraMetadata: {
            conversationId: pubId,
            internalConversationId: realConvId,
          },
        })
        .catch((err) =>
          this.logger.warn('Failed to process message mentions', err),
        );
    }

    return this.formatMessageResponse(
      message,
      realConvId,
      conversationId,
      senderId,
      clientMsgId,
      recipientIds,
      unmutedRecipientIds,
      conv.name || undefined,
      convChatType,
    );
  }

  private async formatMessageResponse(
    message: any,
    realConvId: string,
    publicIdOrId: string,
    senderId: string,
    clientMsgIdHint?: string,
    recipientIds: string[] = [],
    unmutedRecipientIds: string[] = [],
    conversationName: string = '',
    // Which surface this message belongs to. Every client routes notifications
    // and in-app toasts on this field: an Instant Match message opens the
    // Instant Match chat, a normal one deep-links into Messages. Without it a
    // client can only guess from a conversation id, and an Instant Match chat
    // has no row in the conversation list to guess from.
    chatType: 'instant' | 'normal' = 'normal',
  ) {
    const msgPayload = message.payload || {};
    let replyToObj: any = null;
    if (message.replyTo) {
      replyToObj = buildReplyToSnapshot(message.replyTo, senderId);
    }

    const pubId = publicIdOrId || realConvId;
    const clientKey =
      msgPayload.clientId || msgPayload.tempId || clientMsgIdHint || null;
    const isUnsent = message.state === 'UNSENT';

    // Recompute group-invite expiry on read so a stored invite that has since
    // passed its expiresAt reflects isExpired: true without needing a rewrite.
    let outInviteData = isUnsent ? null : msgPayload.inviteData || null;
    if (
      outInviteData &&
      (outInviteData.type === 'group_invite' ||
        outInviteData.groupId ||
        outInviteData.conversationId)
    ) {
      const createdAtMs = message.createdAt
        ? new Date(message.createdAt).getTime()
        : Date.now();
      const expiresAt =
        outInviteData.expiresAt ||
        new Date(createdAtMs + 48 * 60 * 60 * 1000).toISOString();
      outInviteData = {
        ...outInviteData,
        expiresAt,
        isExpired: new Date(expiresAt).getTime() <= Date.now(),
      };
    }

    const msgRes = {
      id: message.id,
      conversationId: pubId,
      publicId: pubId,
      internalId: realConvId,
      senderId: message.senderId,
      senderName:
        message.sender?.displayName || message.sender?.username || 'User',
      senderAvatar: message.sender?.avatar || '',
      createdAt: message.createdAt,
      timestamp: message.createdAt,
      time: new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      type: message.type ? message.type.toLowerCase() : 'chat',
      state: message.state || 'SENT',
      isUnsent,
      payload: isUnsent ? { text: 'This message was unsent' } : msgPayload,
      text: isUnsent ? 'This message was unsent' : msgPayload.text || '',
      mediaUrl: isUnsent ? null : msgPayload.mediaUrl || null,
      mediaType: isUnsent ? null : msgPayload.mediaType || null,
      mentions: isUnsent ? [] : msgPayload.mentions || [],
      inviteData: outInviteData,
      replyTo: isUnsent ? null : replyToObj,
      status: 'sent',
      tempId: clientKey,
      clientId: clientKey,
      recipientIds,
      unmutedRecipientIds,
      conversationName: conversationName || '',
      chatType,
      isInstantMatch: chatType === 'instant',
    };

    // H-3 fix: Pass the affected user IDs to trigger targeted O(1) invalidation
    // rather than the fallback O(N) global scan.
    this.invalidateUserConversationsCache([senderId, ...recipientIds]).catch(
      () => {},
    );

    return msgRes;
  }

  async getCatchupMessages(userId: string, sinceTimestamp: string) {
    if (!userId || !sinceTimestamp) return [];
    const sinceDate = new Date(sinceTimestamp);
    if (isNaN(sinceDate.getTime())) return [];

    const activeConvs = await this.prisma.conversationParticipant.findMany({
      where: { userId, deletedAt: null, leftAt: null },
      select: { conversationId: true },
    });
    if (activeConvs.length === 0) return [];

    const convIds = activeConvs.map((c) => c.conversationId);
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: { in: convIds },
        createdAt: { gt: sinceDate },
        deletedAt: null,
        deletedByUsers: { none: { userId } },
      },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatar: true },
        },
        replyTo: { select: REPLY_TO_SELECT },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    const formatted = await Promise.all(
      messages.map((m) =>
        this.formatMessageResponse(
          m,
          m.conversationId,
          m.conversationId,
          userId,
        ),
      ),
    );

    return formatted;
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
    const whereCondition: any = {
      conversationId: realConvId,
      deletedAt: null,
    };

    const [deletedForUser, currentParticipant, participants] =
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
                conversationId: realConvId,
                userId: currentUserId,
                deletedAt: null,
              },
              select: {
                userId: true,
                lastReadAt: true,
                clearedAt: true,
                leftAt: true,
              },
            })
          : Promise.resolve(null),
        this.prisma.conversationParticipant.findMany({
          where: { conversationId: realConvId, deletedAt: null },
          select: {
            userId: true,
            lastReadAt: true,
            clearedAt: true,
            leftAt: true,
          },
        }),
      ]);

    if (deletedForUser && deletedForUser.length > 0) {
      whereCondition.id = { notIn: deletedForUser.map((d) => d.messageId) };
    }

    if (currentUserId && !currentParticipant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    const participant = currentParticipant;

    if (participant) {
      clearedAt = participant.clearedAt;
      const pLeftAt = participant.leftAt;
      if (pLeftAt) {
        whereCondition.createdAt = { lte: pLeftAt };
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
      whereCondition.createdAt = {
        ...(whereCondition.createdAt || {}),
        gt: clearedAt,
      };
    }

    const orConditions: any[] = [];

    // Pagination logic
    if (beforeCursor) {
      let cursorDate: Date | null = null;
      let cursorId: string | null = null;

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
          whereCondition.createdAt = {
            ...(typeof whereCondition.createdAt === 'object'
              ? whereCondition.createdAt
              : {}),
            lt: cursorDate,
          };
        }
      }
    }

    if (orConditions.length > 0) {
      whereCondition.AND = [...(whereCondition.AND || []), ...orConditions];
    }

    const messages: any[] = await this.prisma.message.findMany({
      where: whereCondition,
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatar: true },
        },
        replyTo: { select: REPLY_TO_SELECT },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop(); // Remove the extra item
    }
    messages.reverse(); // Return in chronological order
    const realDbMessages = messages.filter((m) => !m.id.startsWith('sys_'));
    const oldestRealMessage = realDbMessages[0];
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
      .filter((p) => p.lastReadAt != null)
      .map((p) => new Date(p.lastReadAt!).getTime());

    const isAllRead =
      otherReadTimestamps.length > 0 &&
      otherReadTimestamps.length === otherParticipants.length;
    const minOtherLastReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;

    const messagesMapped = messages.map((m) => {
      const payload = m.payload || {};

      let replyToObj: any = null;
      if (m.replyTo) {
        replyToObj = buildReplyToSnapshot(m.replyTo, currentUserId);
      }

      const isRead =
        currentUserId &&
        m.senderId === currentUserId &&
        isAllRead &&
        minOtherLastReadAt + 5000 >= new Date(m.createdAt).getTime();
      const isUnsent = m.state === 'UNSENT';

      let inviteData = isUnsent ? null : payload.inviteData || null;
      if (
        inviteData &&
        (inviteData.type === 'group_invite' ||
          inviteData.groupId ||
          inviteData.conversationId)
      ) {
        const createdAtMs = m.createdAt
          ? new Date(m.createdAt).getTime()
          : Date.now();
        const expiresAt =
          inviteData.expiresAt ||
          new Date(createdAtMs + 48 * 60 * 60 * 1000).toISOString();
        inviteData = {
          ...inviteData,
          expiresAt,
          isExpired: new Date(expiresAt).getTime() <= Date.now(),
        };
      }

      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: m.sender?.displayName || m.sender?.username || 'User',
        senderAvatar: m.sender?.avatar || '',
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
        text: isUnsent ? 'This message was unsent' : payload.text || '',
        mediaUrl: isUnsent ? null : payload.mediaUrl || null,
        mediaType: isUnsent ? null : payload.mediaType || null,
        mentions: isUnsent ? [] : payload.mentions || [],
        inviteData,
        replyTo: isUnsent ? null : replyToObj,
        status: isRead ? 'read' : 'sent',
        state: m.state || 'SENT',
        isUnsent,
      };
    });

    return {
      messages: messagesMapped,
      participants: participants.map((p) => ({
        userId: p.userId,
        lastReadAt:
          (p as any).user?.settings?.readReceipts !== false
            ? p.lastReadAt
            : null,
      })),
      nextCursor,
    };
  }

  private presenceCache = new Map<string, { data: any; expiresAt: number }>();
  async getUserConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ) {
    const cacheKey = `user:conversations:${userId}:${limit}:${offset}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const [participants, excludedUserIds, blockedByMeIds] = await Promise.all([
      this.prisma.conversationParticipant.findMany({
        where: {
          userId,
          deletedAt: null,
          // Instant Match chats are a separate product surface reached only
          // through Instant Match. They must never appear in Messages, carry
          // a preview there, or contribute to its unread badge.
          conversation: { type: { in: ['DM', 'GROUP'] } },
        },
        // Pinned rows first (most recently pinned at the top), then by recent
        // activity. Ordering pinned-first in SQL rather than only in the client
        // keeps `take`/`skip` pagination correct: a pin must not be able to
        // strand a conversation on a later page than the one the list shows.
        orderBy: [
          { isPinned: 'desc' },
          { pinnedAt: 'desc' },
          { conversation: { updatedAt: 'desc' } },
        ],
        skip: offset,
        take: limit,
        select: {
          isMuted: true,
          isPinned: true,
          pinnedAt: true,
          clearedAt: true,
          lastReadAt: true,
          unreadCount: true,
          groupUpdatesActive: true,
          leftAt: true,
          conversation: {
            select: {
              id: true,
              publicId: true,
              name: true,
              avatarKey: true,
              description: true,
              type: true,
              ownerId: true,
              status: true,
              lastMessageId: true,
              lastMessageText: true,
              lastMessageType: true,
              lastMessageAt: true,
              lastMessageSenderId: true,
              isInstantMatch: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
              whoCanJoin: true,
              visibility: true,
              allowSharing: true,
              editGroupPermission: true,
              _count: {
                select: {
                  participants: {
                    where: { leftAt: null, deletedAt: null },
                  },
                },
              },
            },
          },
        },
      }),
      this.blocksService.getExcludedUserIds(userId),
      this.blocksService.getBlockedByUserIds(userId),
    ]);
    const blockedSet = new Set(excludedUserIds);
    const blockedByMeSet = new Set(blockedByMeIds);

    const dmConvIds = (participants as any[])
      .filter((p: any) => p.conversation.type === 'DM')
      .map((p: any) => p.conversation.id);
    const dmOtherParticipants =
      dmConvIds.length > 0
        ? await this.prisma.conversationParticipant.findMany({
            where: {
              conversationId: { in: dmConvIds },
              userId: { not: userId },
              leftAt: null,
              deletedAt: null,
            },
            select: {
              conversationId: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatar: true,
                  settings: {
                    select: {
                      showOnlineStatus: true,
                      whoCanSeeOnline: true,
                    },
                  },
                },
              },
            },
          })
        : [];

    const targetUserByConvId = new Map<string, any>();
    dmOtherParticipants.forEach((op) => {
      if (op.user) targetUserByConvId.set(op.conversationId, op.user);
    });

    const targetUserIds = Array.from(targetUserByConvId.values()).map(
      (u) => u.id,
    );
    const presenceMap = new Map<
      string,
      { isOnline: boolean; lastActive: string | null }
    >();
    if (targetUserIds.length > 0) {
      const now = Date.now();
      const uncachedIds: string[] = [];
      for (const uId of targetUserIds) {
        const cached = this.presenceCache.get(uId);
        if (cached && cached.expiresAt > now) {
          presenceMap.set(uId, cached.data);
        } else {
          uncachedIds.push(uId);
        }
      }

      if (uncachedIds.length > 0) {
        const batchPresence =
          await this.presenceService.getPresenceMany(uncachedIds);
        batchPresence.forEach((presence, uId) => {
          const presData = {
            isOnline: presence?.status === 'online',
            lastActive: presence?.lastSeen || null,
          };
          presenceMap.set(uId, presData);
          this.presenceCache.set(uId, {
            data: presData,
            expiresAt: now + 5000,
          });
        });
      }
    }

    // Batch presence-visibility for all online, non-blocked DM partners in a
    // single pass: one viewer-settings read + at most two follow queries total,
    // replacing the previous per-conversation checkPresenceVisibility N+1.
    const visTargets: { userId: string; rule: string; isEnabled: boolean }[] =
      [];
    for (const p of participants as any[]) {
      const ou = targetUserByConvId.get(p.conversation.id);
      if (!ou || blockedSet.has(ou.id)) continue;
      if (!presenceMap.get(ou.id)?.isOnline) continue;
      visTargets.push({
        userId: ou.id,
        rule: ou.settings?.whoCanSeeOnline || 'everyone',
        isEnabled: ou.settings?.showOnlineStatus !== false,
      });
    }
    const presenceVisibleSet =
      visTargets.length > 0
        ? await resolvePresenceVisibilityForViewer(
            userId,
            visTargets,
            this.prisma,
            this.blocksService,
          )
        : new Set<string>();

    const result = await Promise.all(
      (participants as any[]).map(async (p: any) => {
        const conv = p.conversation;
        const otherUser = targetUserByConvId.get(conv.id);
        const isGroupConv = conv.type === 'GROUP' || conv.isGroup;
        const groupAvatar = conv.avatarKey || null;

        const userPresence = otherUser ? presenceMap.get(otherUser.id) : null;
        let canSeeOnline = false;
        let blockStatus = {
          isBlocked: false,
          isBlockedByMe: false,
          isBlockedByThem: false,
        };

        if (otherUser) {
          // Directional. `blockedSet` is the MUTUAL set, so using it for
          // `isBlockedByMe` told the person who *was* blocked that they had
          // blocked someone — offering them an Unblock button for a block they
          // never made. Each side now gets its own accurate flag.
          const isBlocked = blockedSet.has(otherUser.id);
          const blockedByMe = blockedByMeSet.has(otherUser.id);
          blockStatus = {
            isBlocked,
            isBlockedByMe: blockedByMe,
            isBlockedByThem: isBlocked && !blockedByMe,
          };
          canSeeOnline =
            !isBlocked &&
            !!userPresence?.isOnline &&
            presenceVisibleSet.has(otherUser.id);
        }

        const pubId = conv.publicId || conv.id;
        const unreadCount = p.unreadCount || 0;

        // The last-message preview lives on the Conversation row and is therefore
        // shared by both participants — but Clear and Delete are per-user. Left
        // unguarded, a user who cleared the chat still saw the other person's
        // last message sitting in their list row, quoting content that no longer
        // exists for them anywhere else. Hide any preview at or before this
        // user's own cutoff; the next message they actually receive is after it
        // and shows normally.
        const cutoff = p.clearedAt as Date | null;
        const previewCleared = Boolean(
          cutoff &&
          conv.lastMessageAt &&
          new Date(conv.lastMessageAt) <= new Date(cutoff),
        );

        const resolvedLastMsg =
          conv.lastMessageAt && !previewCleared
            ? {
                id: conv.lastMessageId || null,
                createdAt: conv.lastMessageAt,
                senderId: conv.lastMessageSenderId || '',
                senderName: conv.lastMessageSenderId === userId ? 'You' : '',
                text: conv.lastMessageText || '',
                type: conv.lastMessageType
                  ? conv.lastMessageType.toLowerCase()
                  : 'chat',
                mediaUrl: null,
                mediaType: null,
              }
            : null;

        return {
          id: pubId,
          publicId: pubId,
          internalId: conv.id,
          type: conv.type,
          isMember: p.leftAt == null,
          ownerId: conv.ownerId || null,
          isGroup: isGroupConv,
          name: isGroupConv
            ? conv.name || 'Group'
            : conv.name || otherUser?.displayName || 'Chat',
          avatar: isGroupConv
            ? groupAvatar
            : conv.avatarKey || otherUser?.avatar || null,
          description: conv.description || null,
          status: conv.status || 'ACTIVE',
          isInstantMatch: conv.isInstantMatch || false,
          expiresAt: conv.expiresAt || null,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          whoCanJoin: conv.whoCanJoin || 'ANYONE',
          visibility: conv.visibility || 'PUBLIC',
          allowSharing: conv.allowSharing !== false,
          editGroupPermission: conv.editGroupPermission || 'ADMIN',
          groupUpdatesActive: p.groupUpdatesActive !== false,
          pendingRequests: [],
          admins: [],
          members: [],
          memberCount: isGroupConv
            ? conv._count?.participants || conv.memberCount || 0
            : 0,
          pinned: p.isPinned || false,
          pinnedAt: p.pinnedAt || null,
          muted: p.isMuted || false,
          // `blocked` drives the locked-input overlay, which both sides must get:
          // neither party can send once a block exists in either direction.
          blocked: blockStatus.isBlocked,
          isBlockedByMe: blockStatus.isBlockedByMe,
          isBlockedByThem: blockStatus.isBlockedByThem,
          unreadCount,
          unread: unreadCount,
          lastMessage: resolvedLastMsg,
          targetUser: otherUser
            ? {
                id: otherUser.id,
                username: otherUser.username,
                displayName: otherUser.displayName,
                avatar: otherUser.avatar,
                isOnline: canSeeOnline
                  ? userPresence?.isOnline || false
                  : false,
                lastActive: userPresence?.lastActive || null,
              }
            : null,
        };
      }),
    );

    if (this.redis) {
      this.redis.setex(cacheKey, 60, JSON.stringify(result)).catch(() => {});
    }

    return result;
  }

  async startConversation(
    userIds: string[],
    currentUserId: string,
    groupName?: string,
  ) {
    const filteredUserIds = (userIds || []).filter(
      (id) => id && id !== currentUserId,
    );

    if (filteredUserIds.length === 0) {
      throw new ForbiddenException('Cannot start a conversation with yourself');
    }

    // Any block in either direction with any invitee blocks the whole
    // conversation. `filterBlockedUsers` drops the blocked ids, so a shorter
    // result means at least one participant is unreachable.
    const reachable = await this.blocksService.filterBlockedUsers(
      currentUserId,
      filteredUserIds,
    );
    if (reachable.length !== filteredUserIds.length) {
      throw new ForbiddenException(
        'Cannot start a conversation with a blocked user',
      );
    }

    if (filteredUserIds.length === 1 && !groupName) {
      const otherUserId = filteredUserIds[0];
      const existing = await this.prisma.conversation.findFirst({
        where: {
          type: 'DM',
          AND: [
            { participants: { some: { userId: currentUserId } } },
            { participants: { some: { userId: otherUserId } } },
          ],
        },
      });
      if (existing) {
        const pubId = (existing as any).publicId || existing.id;
        return { id: pubId, publicId: pubId };
      }
    }

    const participants = [...new Set([...filteredUserIds, currentUserId])].map(
      (id) => ({
        userId: id,
        role: id === currentUserId ? ('OWNER' as const) : ('MEMBER' as const),
      }),
    );

    const newPubId = generatePublicId();
    const conv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        name: groupName || null,
        type: participants.length > 2 || groupName ? 'GROUP' : 'DM',
        ownerId: participants.length > 2 || groupName ? currentUserId : null,
        participants: {
          create: participants,
        },
      },
    });
    return { id: newPubId, publicId: newPubId };
  }

  async reactToMessage(messageId: string, userId: string, reaction: string) {
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

  // markAsRead / _persistMarkAsRead are inherited from MessagingCoreService
  // (write-behind, notifies other participants) — single source of truth.

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

  async unsendMessage(messageId: string, userId: string) {
    return super.unsendMessage(messageId, userId);
  }

  async deleteMessageForMe(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.prisma.deletedMessage.upsert({
      where: { userId_messageId: { userId, messageId } },
      create: { userId, messageId },
      update: {},
    });

    return {
      success: true,
      messageId: message.id,
      conversationId: message.conversationId,
    };
  }

  async forwardMessage(
    messageId: string,
    targetConversationIds: string[],
    userId: string,
  ) {
    const originalMsg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, payload: true, type: true },
    });

    if (!originalMsg) {
      throw new NotFoundException('Message not found');
    }

    const payload = (originalMsg.payload as any) || {};
    const text = payload.text || '';
    const mediaUrl = payload.mediaUrl || null;
    const mediaType = payload.mediaType || null;

    const forwarded: any[] = [];
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
          mediaUrl,
          mediaType,
          replyToId: undefined,
          mentions: [],
          isForwarded: true,
          forwardedFromMessageId: messageId,
        });
      });

      const results = await Promise.all(promises);
      results.forEach((msg: any) => {
        if (msg) forwarded.push(msg);
      });
    }

    return { success: true, count: forwarded.length, messages: forwarded };
  }

  async updateGroupInfo(
    conversationId: string,
    userId: string,
    data: {
      name?: string;
      description?: string;
      avatarKey?: string;
      avatar?: string;
    },
  ) {
    const realConvId = await this.resolveConversationId(conversationId);

    const [participant, conversation] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
      }),
      this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { editGroupPermission: true, avatarKey: true },
      }),
    ]);

    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    const perm = (conversation?.editGroupPermission || '').toUpperCase();
    const isAllowed =
      participant.role === 'OWNER' ||
      participant.role === 'ADMIN' ||
      perm === 'EVERYONE' ||
      perm === 'ALL_MEMBERS' ||
      perm === 'ALL';
    if (!isAllowed) {
      throw new ForbiddenException('Only group admins can edit group details');
    }

    let avatarVal = data.avatarKey !== undefined ? data.avatarKey : data.avatar;
    if (
      avatarVal &&
      typeof avatarVal === 'string' &&
      avatarVal.startsWith('blob:')
    ) {
      avatarVal = undefined;
    }

    let updated: any;
    let participantRows: any[];
    try {
      [updated, participantRows] = await Promise.all([
        this.prisma.conversation.update({
          where: { id: realConvId },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined
              ? { description: data.description }
              : {}),
            ...(avatarVal !== undefined ? { avatarKey: avatarVal } : {}),
          },
        }),
        this.prisma.conversationParticipant.findMany({
          where: { conversationId: realConvId, leftAt: null, deletedAt: null },
          select: { userId: true },
        }),
      ]);
    } catch (err) {
      if (avatarVal) {
        this.mediaCleanupService
          ?.discardFailedNewUpload(avatarVal, userId)
          .catch(() => {});
      }
      throw err;
    }

    if (
      avatarVal !== undefined &&
      conversation?.avatarKey &&
      conversation.avatarKey !== updated.avatarKey
    ) {
      this.mediaCleanupService
        ?.handleMediaReplacement(
          'GROUP_AVATAR',
          realConvId,
          conversation.avatarKey,
          updated.avatarKey,
          userId,
        )
        .catch(() => {});
    }

    this.invalidateUserConversationsCache(participantRows.map((p) => p.userId));

    return updated;
  }

  async addGroupMember(
    conversationId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId: requesterId,
          conversationId: realConvId,
        },
      },
    });
    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

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
        joinedAt: new Date(),
        role: 'MEMBER',
      } as any,
      create: {
        userId: targetUserId,
        conversationId: realConvId,
        role: 'MEMBER',
      },
    });

    this.invalidateUserConversationsCache([targetUserId]).catch(() => {});
    return { success: true };
  }

  async removeGroupMember(
    conversationId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const requester = await this.prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId: requesterId,
          conversationId: realConvId,
        },
      },
    });
    if (
      !requester ||
      (requester.role !== 'OWNER' && requester.role !== 'ADMIN')
    ) {
      throw new ForbiddenException('Only group admins can remove members');
    }

    const target = await this.prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId: targetUserId,
          conversationId: realConvId,
        },
      },
    });

    if (!target || (target as any).leftAt || target.deletedAt) {
      throw new NotFoundException('Member not found in group');
    }

    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the group owner');
    }

    if (requester.role === 'ADMIN' && target.role === 'ADMIN') {
      throw new ForbiddenException(
        'Admins cannot remove other admins. Only the owner can remove admins.',
      );
    }

    await this.prisma.conversationParticipant.update({
      where: {
        userId_conversationId: {
          userId: targetUserId,
          conversationId: realConvId,
        },
      },
      data: { leftAt: new Date() } as any,
    });

    this.invalidateUserConversationsCache([targetUserId]).catch(() => {});
    return { success: true };
  }

  async leaveGroup(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });

    if (!participant || (participant as any).leftAt || participant.deletedAt) {
      return { success: true };
    }

    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      data: { leftAt: new Date() } as any,
    });

    this.invalidateUserConversationsCache([userId]).catch(() => {});

    if (participant.role === 'OWNER') {
      // Transfer to oldest admin first
      const oldestAdmin = await this.prisma.conversationParticipant.findFirst({
        where: {
          conversationId: realConvId,
          deletedAt: null,
          leftAt: null,
          role: 'ADMIN',
        },
        orderBy: { joinedAt: 'asc' },
      });

      if (oldestAdmin) {
        await this.prisma.$transaction([
          this.prisma.conversationParticipant.update({
            where: {
              userId_conversationId: {
                userId: oldestAdmin.userId,
                conversationId: realConvId,
              },
            },
            data: { role: 'OWNER' },
          }),
          this.prisma.conversation.update({
            where: { id: realConvId },
            data: { ownerId: oldestAdmin.userId },
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
            this.prisma.conversationParticipant.update({
              where: {
                userId_conversationId: {
                  userId: oldestMember.userId,
                  conversationId: realConvId,
                },
              },
              data: { role: 'OWNER' },
            }),
            this.prisma.conversation.update({
              where: { id: realConvId },
              data: { ownerId: oldestMember.userId },
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

    return { success: true };
  }

  async createInstantMatchConversation(
    userAId: string,
    userBId: string,
    activity: string,
  ): Promise<{ id: string; internalId: string; expiresAt: number }> {
    if (!userAId || !userBId || userAId === userBId) {
      throw new BadRequestException('Invalid instant match participants');
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Only an instant-match DM that is still within its 24h window can be
    // reused. Reusing an already-expired one would hand a freshly matched
    // pair a conversation that the expiry cleanup is about to delete.
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'INSTANT_MATCH',
        isInstantMatch: true,
        expiresAt: { gt: new Date() },
        AND: [
          { participants: { some: { userId: userAId } } },
          { participants: { some: { userId: userBId } } },
        ],
      },
    });

    if (existing) {
      // No cache to invalidate: these conversations are not in any list.
      const pubId = (existing as any).publicId || existing.id;
      return {
        id: pubId,
        internalId: existing.id,
        expiresAt: (existing.expiresAt ?? expiresAt).getTime(),
      };
    }

    // No opening system message, and no denormalised lastMessage preview.
    // Both existed so the chat would show up in the Messages list the moment
    // the match was made; Instant Match conversations are no longer listed
    // there at all, so nothing reads either one. The dedicated chat opens
    // from the match session, not from a conversation list, and starts as a
    // genuinely empty thread with its own header and starter prompts.
    const newPubId = generatePublicId();
    const conv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        // Its own type, not a flagged DM. Every existing query that asks for
        // `type: 'DM'` excludes Instant Match chats without having to know
        // they exist.
        type: 'INSTANT_MATCH',
        // Kept in step with the type for the benefit of older rows and any
        // read path still checking the flag.
        isInstantMatch: true,
        expiresAt,
        participants: {
          create: [{ userId: userAId }, { userId: userBId }],
        },
      },
    });

    return {
      id: newPubId,
      internalId: conv.id,
      expiresAt: expiresAt.getTime(),
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
      } as any,
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
      } as any,
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }

  async updateGroupSettings(conversationId: string, userId: string, data: any) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });

    if (data.groupUpdatesActive !== undefined && participant) {
      await this.prisma.conversationParticipant.update({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
        data: { groupUpdatesActive: data.groupUpdatesActive },
      });
      delete data.groupUpdatesActive;
    }

    // Whitelist admin-editable settings — never write the raw body (prevents
    // mass-assignment of ownerId/status/type/expiresAt/etc.).
    const ALLOWED_SETTINGS = [
      'whoCanJoin',
      'visibility',
      'allowSharing',
      'editGroupPermission',
    ] as const;
    const settingsData: any = {};
    for (const key of ALLOWED_SETTINGS) {
      if (data[key] !== undefined) settingsData[key] = data[key];
    }

    if (Object.keys(settingsData).length > 0) {
      if (
        !participant ||
        (participant.role !== 'OWNER' && participant.role !== 'ADMIN')
      ) {
        throw new ForbiddenException(
          'Only group admins can update these settings',
        );
      }
      await this.prisma.conversation.update({
        where: { id: realConvId },
        data: settingsData,
      });
    }
    return { success: true };
  }

  async updateGroupEditPermission(
    conversationId: string,
    userId: string,
    permission: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });
    if (
      !participant ||
      (participant.role !== 'OWNER' && participant.role !== 'ADMIN')
    ) {
      throw new ForbiddenException('Only group admins can update settings');
    }
    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { editGroupPermission: permission },
    });
    return { success: true };
  }

  // changeGroupOwner / promoteToAdmin / demoteFromAdmin / endGroup are inherited
  // from MessagingCoreService (single source of truth, with target validation).

  async acceptGroupJoinRequest(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });
    if (
      !participant ||
      (participant.role !== 'OWNER' && participant.role !== 'ADMIN')
    ) {
      throw new ForbiddenException('Only group admins can accept requests');
    }

    const joinRequest = await this.prisma.conversationJoinRequest.findUnique({
      where: {
        conversationId_userId: {
          conversationId: realConvId,
          userId: targetUserId,
        },
      },
    });

    if (!joinRequest) {
      throw new NotFoundException('Join request not found');
    }

    if (joinRequest.expiresAt && joinRequest.expiresAt < new Date()) {
      await this.prisma.conversationJoinRequest.delete({
        where: {
          conversationId_userId: {
            conversationId: realConvId,
            userId: targetUserId,
          },
        },
      });
      throw new BadRequestException('Join request has expired');
    }

    await this.prisma.$transaction([
      this.prisma.conversationJoinRequest.delete({
        where: {
          conversationId_userId: {
            conversationId: realConvId,
            userId: targetUserId,
          },
        },
      }),
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
          joinedAt: new Date(),
          role: 'MEMBER',
        } as any,
        create: {
          userId: targetUserId,
          conversationId: realConvId,
          role: 'MEMBER',
        },
      }),
    ]);
    return { success: true };
  }

  async declineGroupJoinRequest(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
    });
    if (
      !participant ||
      (participant.role !== 'OWNER' && participant.role !== 'ADMIN')
    ) {
      throw new ForbiddenException('Only group admins can decline requests');
    }

    await this.prisma.conversationJoinRequest
      .delete({
        where: {
          conversationId_userId: {
            conversationId: realConvId,
            userId: targetUserId,
          },
        },
      })
      .catch(() => {});

    return { success: true };
  }

  async getUserHandle(userId: string): Promise<string> {
    if (!userId) return '@user';
    const cached = this.handleCache.get(userId);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });
    if (!user) return 'Someone';
    const rawName = user.username || user.displayName || 'Someone';
    const handle = rawName.startsWith('@') ? rawName : `@${rawName}`;
    this.handleCache.set(userId, handle);
    return handle;
  }

  async createSystemMessage(
    conversationId: string,
    senderId: string,
    text: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const message: any = await this.prisma.message.create({
      data: {
        conversationId: realConvId,
        senderId,
        type: 'SYSTEM',
        payload: { text },
      },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatar: true },
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { updatedAt: new Date() },
    });

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName:
        message.sender?.displayName || message.sender?.username || 'System',
      senderAvatar: message.sender?.avatar || '',
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

  async getConversationById(conversationId: string) {
    const realId = await this.resolveConversationId(conversationId);
    return this.prisma.conversation.findUnique({
      where: { id: realId },
      include: {
        avatarMedia: true,
      },
    });
  }
}
