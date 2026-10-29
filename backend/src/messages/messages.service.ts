import type { GroupDepartureEvent } from './group-departure-announce.util';
import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Optional,
} from '@nestjs/common';
import { storableInviteData, withInviteExpiry } from './core/invite-data';
import {
  arrayOrEmpty,
  payloadFields,
  stringOrEmpty,
  stringOrNull,
} from './core/message-payload';
import { isJsonValue } from '../common/utils/json.util';
import { isRecord } from '../common/utils/type-guards.util';
import { OnEvent } from '@nestjs/event-emitter';
import {
  MentionSource,
  NotificationEntityType,
  Prisma,
  type Conversation,
} from '@prisma/client';
import {
  assertGroupAuthority,
  groupAsSeenBy,
  membershipChangedAt,
  notAMemberError,
} from './core/group-membership';
import { previewText } from './core/message-preview';
import {
  everyoneSpan,
  mentionNotifyIds,
  peopleMentions,
  storedMentions,
} from './core/message-mentions';
import { resolveViewerPreviews, viewerUpdatedAt } from './core/viewer-preview';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { traceBackground } from '../observability/background-trace';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { generatePublicId } from '../common/utils/public-id.util';
import { LruCache } from '../common/utils/lru-cache.util';
import { MessagingCoreService } from './core/messaging-core.service';
import { SendMessageDto } from './core/dto/send-message.dto';
import {
  assertMessageTextWithinLimit,
  assertSendWithinRateLimit,
  assertForwardWithinRateLimit,
  assertNewConversationWithinRateLimit,
} from './core/message-limits';
import { withDmCreateLock } from './core/dm-lock';
import { retryOnClientIdConflict, withClientSendLock } from './core/send-lock';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { resolvePresenceVisibilityForViewer } from '../users/privacy.helper';
import { MentionsService } from '../mentions/mentions.service';
import { buildReplyToSnapshot, REPLY_TO_SELECT } from './reply-preview.util';
import {
  buildMediaCursor,
  clampMediaLimit,
  mediaMessageFilter,
  parseMediaCursor,
  toMediaItem,
  type ConversationMediaItem,
  type ConversationMediaPage,
} from './conversation-media.util';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import {
  isUnavailableUser,
  presentUserName,
  presentUserAvatar,
  DELETED_USER_USERNAME,
} from '../common/users/deleted-user';
import {
  asBoolean,
  asNumberOrNull,
  asString,
  asStringOrNull,
} from '../common/utils/coerce.util';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import {
  UpdateGroupSettingsDto,
  pickGroupSettings,
} from './dto/update-group-settings.dto';
import {
  conversationListCacheKey,
  conversationListFirstPageKeys,
  groupDetailsVersionKey,
} from './conversation-list-cache';
import { announceRevived, revivedMemberIds } from './core/conversation-revive';

/** The questions MessagesService asks the Instant Match domain. Kept small so
 *  the coupling between the two stays visible: may this user write into this
 *  chat, and may they read it at all. */
export interface InstantMatchChatGuard {
  assertCanSendInChat(userId: string, conversationId: string): Promise<void>;
  /** True only while the session behind this conversation is live and the
   *  caller is one of its two participants. */
  canReadChat(userId: string, conversationId: string): Promise<boolean>;
}

/** One conversation that raises the message badge (see getUnreadSummary). */
export interface UnreadSummaryEntry {
  /** The public id, as the conversation list names it. */
  id: string;
  internalId: string;
  isGroup: boolean;
  unread: number;
}

export interface UnreadSummary {
  conversations: UnreadSummaryEntry[];
}

/** More than anyone has unread at once; bounds the response. */
const UNREAD_SUMMARY_MAX = 500;

/**
 * The message row formatMessageResponse reads: the smallest shape its three
 * callers select (send, idempotent resend, catch-up). Catch-up selects more
 * sender fields, which still satisfies it.
 */
type ResponseMessageRow = Prisma.MessageGetPayload<{
  include: {
    sender: {
      select: { id: true; username: true; displayName: true; avatar: true };
    };
    replyTo: { select: typeof REPLY_TO_SELECT };
  };
}>;

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
    // Same reasoning as blocksService: verification gating on every send runs
    // through this, so it must fail at boot rather than silently disappear.
    verificationAccess: VerificationAccessService,
    // Required, and ahead of the optional params because a required parameter
    // cannot follow one: the send rate limit runs through this on every path.
    rateLimit: RateLimitService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly mediaCleanupService?: MediaCleanupService,
  ) {
    super(
      prisma,
      presenceService,
      domainEventService,
      mentionsService,
      blocksService,
      verificationAccess,
      rateLimit,
    );
    this.redis = this.redisService?.getClient() ?? null;
  }

  /**
   * The conversation list carries `canSendMessages`, and it is Redis-cached
   * per viewer for 60s. A verification change therefore has to evict those
   * entries or a reload within that window would restore a composer the server
   * is already refusing. The event targets exactly the affected viewers: the
   * user whose status changed, plus everyone holding a DM with them.
   */
  @OnEvent('user:verification_changed')
  async handleVerificationChanged(payload: unknown) {
    const listed = isRecord(payload) ? payload.targetUserIds : undefined;
    const targets: string[] = Array.isArray(listed)
      ? listed.filter((t): t is string => typeof t === 'string')
      : [];
    if (targets.length === 0) return;
    await this.invalidateUserConversationsCache(targets).catch(() => {});
  }

  /**
   * Same problem, same fix, for the deletion lifecycle.
   *
   * The conversation list is cached per viewer for 60s and carries the other
   * person's name, avatar and `targetUserUnavailable`. Without this eviction a
   * partner who reloaded inside that window would keep seeing the deleted
   * account's real name and photo, and an enabled composer, for up to a minute
   * after the deletion — and after a recovery, would keep seeing "Deleted User"
   * for just as long.
   *
   * The affected viewers are exactly this user's conversation partners, so
   * they are resolved rather than flushing every cached list on the instance.
   */
  @OnEvent('user.deletion_requested')
  @OnEvent('user.deletion_cancelled')
  @OnEvent('user.deleted')
  async handleAccountLifecycleChanged(payload: unknown) {
    const event = isRecord(payload) ? payload : {};
    const data = isRecord(event.data) ? event.data : {};
    const userId =
      (typeof data.userId === 'string' && data.userId) ||
      (typeof event.userId === 'string' && event.userId) ||
      undefined;
    if (!userId) return;

    try {
      // Paged rather than capped. A single `take: 500` looks safe until the one
      // account with 600 conversation partners deletes itself and the last 100
      // keep seeing a real name and an enabled composer — a privacy bug whose
      // trigger is "unusually popular user", i.e. exactly the account where it
      // matters most. Keyset-paginated on `userId` so the walk is bounded per
      // query but complete overall, and the eviction is issued per page so a
      // large fan-out never builds one enormous DEL.
      const PAGE = 500;
      let cursor: string | undefined;
      let evicted = 0;

      // The user's own cached list goes first, before any paging can fail.
      await this.invalidateUserConversationsCache([userId]);

      for (;;) {
        const partnerRows: { userId: string }[] =
          await this.prisma.conversationParticipant.findMany({
            where: {
              userId: cursor ? { not: userId, gt: cursor } : { not: userId },
              conversation: { participants: { some: { userId } } },
            },
            select: { userId: true },
            distinct: ['userId'],
            orderBy: { userId: 'asc' },
            take: PAGE,
          });

        if (partnerRows.length === 0) break;

        await this.invalidateUserConversationsCache(
          partnerRows.map((p) => p.userId),
        );
        evicted += partnerRows.length;
        cursor = partnerRows[partnerRows.length - 1].userId;
        if (partnerRows.length < PAGE) break;
      }

      this.logger.log(
        `Evicted conversation caches for ${evicted} partner(s) of ${userId}`,
      );
    } catch (err) {
      // A cache that failed to clear is a staleness bug, not a correctness one:
      // every gate that matters re-reads Postgres.
      this.logger.warn(
        `Conversation-cache eviction failed for ${userId}: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Retires the group's cached details (GroupChatsService getGroupDetails),
   * which every member's roster is read from. Membership changed through this
   * service's routes used to leave them for up to the 15s TTL.
   */
  protected override async invalidateGroupDetailsVersion(
    realConvId: string,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.incr(groupDetailsVersionKey(realConvId));
    } catch {
      // A stale roster for at most the cache's TTL beats failing the change.
    }
  }

  async invalidateUserConversationsCache(userIds?: string[]) {
    if (!this.redis) return;
    try {
      if (userIds && userIds.length > 0) {
        // H-3 fix: Construct keys directly from known user IDs — no SCAN needed.
        // The conversation list is paginated with limit/offset; we invalidate page 0
        // (the most common fetch) plus a few common limits to cover the UI variants.
        const keysToDelete = userIds.flatMap(conversationListFirstPageKeys);
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
    } catch {
      // Best effort cache sweep; stale entries expire on their own.
    }
  }

  async onModuleInit() {
    await this.cleanupExpiredInstantMatches();
    // Every 5 minutes rather than 15: the sidebar shows a live countdown, so
    // a chat that lingers for up to a quarter of an hour past "expired" reads
    // as broken. Expiry is driven purely by `expiresAt`, which is stamped at
    // creation — it does not depend on any message ever being sent.
    this.instantMatchCleanupTimer = setInterval(
      () =>
        // 288 a day, so traced at 10% (observability/background-trace).
        void traceBackground(
          {
            name: 'task messages.instant-match-chat-cleanup',
            op: 'task',
            traceRate: 0.1,
          },
          () => this.cleanupExpiredInstantMatches(),
        ),
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

  // Bounded LRU (5 min TTL, see H-4 below); a Map here grew with every
  // distinct identifier:viewer pair and never evicted.
  private resolveCache = new LruCache<string, string>(5000, 5 * 60 * 1000);

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
    if (cached) {
      return cached;
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
          this.resolveCache.set(cacheKey, directConv.id);
          return directConv.id;
        }
      }

      // 2. Direct index lookup via publicId (@unique index scan: 0.01ms)
      const pubConv = await this.prisma.conversation.findUnique({
        where: { publicId: cleanId },
        select: { id: true },
      });
      if (pubConv?.id) {
        this.resolveCache.set(cacheKey, pubConv.id);
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
          this.resolveCache.set(cacheKey, dm.id);
          return dm.id;
        }
      }
    } catch {
      // ignore
    }
    return identifier;
  }

  /**
   * The socket path's send. Same contract as the inherited one: one message
   * per client message id, under a per-id lock so two copies arriving at once
   * (the socket send and its REST fallback) cannot both insert.
   */
  async sendMessage(
    senderId: string,
    conversationId: string,
    payload: SendMessageDto,
  ) {
    return withClientSendLock(
      this.redisService,
      senderId,
      payload.clientId || payload.tempId,
      () =>
        retryOnClientIdConflict(() =>
          this.sendViaSocketPath(senderId, conversationId, payload),
        ),
    );
  }

  private async sendViaSocketPath(
    senderId: string,
    conversationId: string,
    payload: SendMessageDto,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);

    // The attachment check MessagingCoreService runs, for the socket path.
    if (payload?.mediaUrl) {
      await this.attachmentStorage?.assertMessageAttachmentWithinLimits(
        payload.mediaUrl,
      );
    }

    // The socket path (`message:send`) lands here, and it carries almost all
    // real traffic — so the limit has to be here as well as in
    // MessagingCoreService. Shared budget, so the REST aliases and the socket
    // cannot be alternated to get more. See message-limits.ts.
    await assertSendWithinRateLimit(this.rateLimit, senderId, realConvId);

    const conv = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: {
        id: true,
        publicId: true,
        name: true,
        type: true,
        isInstantMatch: true,
        participants: {
          // `deletedAt` is deliberately NOT filtered, as in
          // MessagingCoreService.sendMessage: someone who deleted (hid) the
          // chat is still in it. Filtering them out here, on the path almost
          // every message takes, meant they got no message, no unread count
          // and no push, and the chat never came back for them. `leftAt` is
          // different: that person really is gone.
          where: { leftAt: null },
          select: {
            userId: true,
            isMuted: true,
            // Who has it hidden: they join its rooms as it comes back.
            deletedAt: true,
            // Lifecycle state of each member, for the unavailable-recipient
            // gate below (same rule as MessagingCoreService.sendMessage).
            user: { select: { accountStatus: true, deletedAt: true } },
          },
        },
      },
    });

    if (!conv) {
      throw new ForbiddenException('Conversation not found');
    }

    // 1. Idempotency check, BEFORE any permission check. A retry of a send
    // that already landed must get that message back even if the thread has
    // since closed (blocked, left, match ended): refusing it would show the
    // sender "Not delivered" for a message the recipient already has. The
    // lookup is scoped to this sender, so it can only return their own row.
    const clientMsgId = payload.clientId || payload.tempId;
    if (clientMsgId) {
      // Idempotency: match on the indexed `clientMessageId` column (index
      // [senderId, clientMessageId]) instead of a JSON payload-path predicate.
      // The old `payload->>'tempId'` / `payload->>'clientId'` predicates could
      // not use any index and forced a filtered scan of the sender's messages
      // on every send. The column is written below (`clientMessageId: clientMsgId`).
      const existing = await this.prisma.message.findFirst({
        // The unique index's own scope; see MessagingCoreService.
        where: { senderId, clientMessageId: clientMsgId },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
              // Required for the tombstone projection (common/users/deleted-user.ts).
              accountStatus: true,
              deletedAt: true,
            },
          },
          replyTo: { select: REPLY_TO_SELECT },
        },
      });
      if (existing && existing.conversationId !== realConvId) {
        throw new BadRequestException('Message id already used');
      }
      if (existing) {
        // No recipients: the gateway fans a send out to these (events and
        // push), and the original send already reached them.
        return this.formatMessageResponse(
          existing,
          realConvId,
          conversationId,
          senderId,
          clientMsgId,
          [],
          [],
          conv.name || undefined,
          conv.type === 'INSTANT_MATCH' || conv.isInstantMatch
            ? 'instant'
            : 'normal',
        );
      }
    }

    /**
     * A message has to be *something*.
     *
     * Every field on SendMessageDto is optional, which is right individually
     * and wrong in combination: a body with no text, no media and no invite
     * validated cleanly and was written, broadcast and rendered as a bubble
     * containing a timestamp and nothing else. That is exactly what a client
     * bug looks like from the outside — the messages were "not rendering" —
     * and the server had quietly agreed to store them. Refusing here means a
     * client that loses the text on its way to the wire fails loudly at the
     * send instead of persisting a row nobody can read.
     *
     * System messages do not come through this method, and voice notes,
     * media and invites all satisfy one of the three branches.
     */
    // Bounded before anything else touches it. See message-limits.ts: the
    // socket gateway reaches this method without passing through the HTTP
    // ValidationPipe, so the DTO's @MaxLength does not cover the busiest path.
    assertMessageTextWithinLimit(payload?.text);

    const hasText =
      typeof payload?.text === 'string' && payload.text.trim().length > 0;
    const hasMedia = Boolean(payload?.mediaUrl);
    const hasInvite = Boolean(payload?.inviteData);
    if (!hasText && !hasMedia && !hasInvite) {
      throw new BadRequestException('Cannot send an empty message');
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
      throw notAMemberError();
    }

    // Unavailable-recipient gate. This override does not call
    // super.sendMessage, and it is the path the socket and REST both reach, so
    // it needs its own copy: a 1:1 thread whose only other member is deleted
    // or pending deletion is closed for writes. In a group the thread stays
    // open but an unavailable member is dropped from the recipient set.
    const otherParticipants = conv.participants.filter(
      (p) => p.userId !== senderId,
    );
    const unavailableOthers = otherParticipants.filter((p) =>
      isUnavailableUser(p.user),
    );
    if (otherParticipants.length === 1 && unavailableOthers.length === 1) {
      throw new ForbiddenException({
        code: 'RECIPIENT_UNAVAILABLE',
        message: 'This user is no longer available.',
      });
    }
    // Verification gate. This override does not call super.sendMessage, so it
    // needs its own copy of the check the core service performs — and it is
    // the one the Socket.IO `message:send` handler reaches, which carries no
    // guard of its own.
    await this.verificationAccess.assertCanMessageInConversation(
      conv.id,
      senderId,
      conv.participants.map((p) => p.userId),
      conv.type === 'GROUP',
    );

    const unavailableIds = new Set(unavailableOthers.map((p) => p.userId));
    const otherUserIds = otherParticipants
      .map((p) => p.userId)
      .filter((id) => !unavailableIds.has(id));
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

    // Mentions are a group feature (core/message-mentions.ts): re-derived from
    // the text, members only, `@everyone` only where the text says it.
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
    const initialInviteData = withInviteExpiry(
      storableInviteData(payload.inviteData),
    );

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
            // Coerced, not `|| ''`: `payload` is unvalidated client JSON, so a
            // non-string here would be written straight into the Json column
            // and later break every consumer that assumes a string.
            text: asString(payload.text),
            mediaUrl: asStringOrNull(payload.mediaUrl),
            mediaType: asStringOrNull(payload.mediaType),
            // Lightweight media metadata for instant, layout-stable recipient rendering.
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
            tempId: clientMsgId || null,
            clientId: clientMsgId || null,
          },
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
          // Same table as the REST path (message-preview.ts).
          lastMessageText: previewText({
            type,
            payload: {
              text: payload.text,
              mediaUrl: payload.mediaUrl,
              mediaType: payload.mediaType,
              inviteData: initialInviteData,
            },
          }),
          lastMessageType: type,
          lastMessageAt: msg.createdAt,
          lastMessageSenderId: senderId,
        },
      });

      // The sender's membership, re-read now that the conversation row is
      // locked. A removal takes the same lock first (markParticipantLeft), so
      // one that committed while this send was in flight is seen here and the
      // message is rolled back instead of landing from a removed member.
      const stillMember = await tx.conversationParticipant.count({
        where: { conversationId: realConvId, userId: senderId, leftAt: null },
      });
      if (stillMember === 0) throw notAMemberError();

      await tx.conversationParticipant.updateMany({
        where: {
          conversationId: realConvId,
          userId: { not: senderId },
          leftAt: null,
        },
        data: { unreadCount: { increment: 1 } },
      });

      // New activity brings the chat back for anyone who had deleted it,
      // sender included (the same revive as the REST path); `clearedAt` stays,
      // so it returns without the old messages.
      await tx.conversationParticipant.updateMany({
        where: {
          conversationId: realConvId,
          leftAt: null,
          deletedAt: { not: null },
        },
        data: { deletedAt: null },
      });

      return msg;
    });

    announceRevived(
      this.domainEventService,
      {
        conversationId: conv.publicId || conversationId,
        publicId: conv.publicId,
        internalId: realConvId,
      },
      revivedMemberIds(conv.participants),
    );

    // Fire-and-forget: must never add latency to message delivery, and a
    // notification failure must never roll back the already-committed message.
    // Notified: the tagged members (or everyone), never anyone who muted it.
    const mentionTargets = mentionNotifyIds({
      named: namedMentions.map((m) => m.userId),
      everyone: Boolean(everyone),
      recipientIds,
      unmutedRecipientIds,
    });
    if (
      mentionTargets.length > 0 &&
      message.sender &&
      message.state !== 'UNSENT'
    ) {
      const pubId = conv.publicId || conversationId;
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

  private formatMessageResponse(
    message: ResponseMessageRow,
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
    const msgPayload = payloadFields(message.payload);
    const replyToObj = message.replyTo
      ? buildReplyToSnapshot(message.replyTo, senderId)
      : null;

    const pubId = publicIdOrId || realConvId;
    const clientKey =
      stringOrNull(msgPayload.clientId) ||
      stringOrNull(msgPayload.tempId) ||
      clientMsgIdHint ||
      null;
    const isUnsent = message.state === 'UNSENT';

    // Recompute group-invite expiry on read so a stored invite that has since
    // passed its expiresAt reflects isExpired: true without needing a rewrite.
    const outInviteData = withInviteExpiry(
      isUnsent ? null : msgPayload.inviteData,
      message.createdAt,
    );

    const msgRes = {
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

  /** Messages per catch-up page. The client pages until `hasMore` is false. */
  static readonly CATCHUP_PAGE_SIZE = 200;

  /**
   * How far before `since` the first page re-reads.
   *
   * `createdAt` is stamped when a row is inserted, not when it commits, so a
   * message stamped just before a catch-up query can commit just after it and
   * fall behind a sync point that has already moved past it. Re-reading a
   * short window catches it; the client already drops ids it holds.
   */
  static readonly CATCHUP_OVERLAP_MS = 10_000;

  /** Instant-match read checks run at most this many at once per catch-up. */
  static readonly CATCHUP_GUARD_BATCH = 10;

  /**
   * Messages the user missed while disconnected, oldest first, one page at a
   * time.
   *
   * This used to return the first 100 after `since` with no way to ask for
   * more, and the client then moved its sync point to its own clock, so a long
   * absence silently lost everything past the first 100. Now:
   *
   * - pages are keyset on (createdAt, id) and say whether more remain;
   * - `syncedAt` is the SERVER's clock at the start of the query, the only
   *   value a client may store as its next `since`;
   * - a conversation the user cleared is honoured, as history does.
   *
   * `after` is the `cursor` from the previous page. Malformed input yields an
   * empty, final page rather than an error, as it always has.
   */
  async getCatchupMessages(
    userId: string,
    sinceTimestamp: string,
    after?: string,
  ): Promise<{
    messages: ReturnType<MessagesService['formatMessageResponse']>[];
    hasMore: boolean;
    cursor: string | null;
    syncedAt: string;
  }> {
    const syncedAt = new Date().toISOString();
    const empty = { messages: [], hasMore: false, cursor: null, syncedAt };
    if (!userId || !sinceTimestamp) return empty;
    const sinceDate = new Date(sinceTimestamp);
    if (isNaN(sinceDate.getTime())) return empty;

    // The resume point: the previous page's last row, or the overlap-adjusted
    // `since` on the first page.
    let fromDate = new Date(
      sinceDate.getTime() - MessagesService.CATCHUP_OVERLAP_MS,
    );
    let fromId: string | null = null;
    if (after) {
      const [dateStr, id] = after.split('|');
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime()) || !id) return empty;
      // A cursor only ever moves forward from the first page's start. One
      // that points earlier is not a continuation, and would turn catch-up
      // into a way to page through a user's whole history at reconnect cost.
      if (parsed < fromDate) return empty;
      fromDate = parsed;
      fromId = id;
    }

    // Conversations the user is in, plus ones they left during the gap: what
    // was said before they left is still theirs to see, as history shows it.
    const memberships = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [{ leftAt: null }, { leftAt: { gt: fromDate } }],
      },
      select: {
        conversationId: true,
        clearedAt: true,
        leftAt: true,
        conversation: { select: { type: true, isInstantMatch: true } },
      },
    });

    // An instant-match chat is readable only while its session allows it,
    // the same gate history applies. Checked a few at a time: one lookup per
    // instant-match membership, all at once, let a user with many past
    // matches fan a single reconnect out across the connection pool.
    type Membership = (typeof memberships)[number];
    const readable: Membership[] = [];
    const instant: Membership[] = [];
    for (const m of memberships) {
      if (
        m.conversation.type === 'INSTANT_MATCH' ||
        m.conversation.isInstantMatch
      ) {
        instant.push(m);
      } else {
        readable.push(m);
      }
    }
    for (
      let i = 0;
      i < instant.length;
      i += MessagesService.CATCHUP_GUARD_BATCH
    ) {
      const batch = instant.slice(i, i + MessagesService.CATCHUP_GUARD_BATCH);
      const allowed = await Promise.all(
        // No guard wired: not readable, the same as before.
        batch.map(async (m) =>
          this.instantMatchGuard
            ? this.instantMatchGuard.canReadChat(userId, m.conversationId)
            : false,
        ),
      );
      batch.forEach((m, idx) => {
        if (allowed[idx]) readable.push(m);
      });
    }
    if (readable.length === 0) return empty;

    const take = MessagesService.CATCHUP_PAGE_SIZE;
    // One range per conversation, each carrying its OWN lower bound. With the
    // resume point as a separate AND outside these branches, Postgres could
    // only use `conversationId` from the (conversationId, createdAt) index and
    // filtered `createdAt` afterwards, reading every conversation's whole
    // history on each reconnect. Here every branch is a tight index range.
    const ranges: Prisma.MessageWhereInput[] = [];
    for (const m of readable) {
      const upper = m.leftAt ? { lte: m.leftAt } : {};
      // A chat cleared after the resume point starts at the clear; the
      // keyset tie-break cannot apply to it.
      if (m.clearedAt && m.clearedAt >= fromDate) {
        ranges.push({
          conversationId: m.conversationId,
          createdAt: { gt: m.clearedAt, ...upper },
        });
        continue;
      }
      ranges.push({
        conversationId: m.conversationId,
        createdAt: { gt: fromDate, ...upper },
      });
      // Rows in the resume point's own millisecond that sort after the last
      // one the previous page returned.
      if (fromId && (!m.leftAt || fromDate <= m.leftAt)) {
        ranges.push({
          conversationId: m.conversationId,
          createdAt: fromDate,
          id: { gt: fromId },
        });
      }
    }
    const messages = await this.prisma.message.findMany({
      where: {
        // Per conversation: a chat the user cleared stays cleared, and one
        // they left stops where they left it.
        OR: ranges,
        deletedAt: null,
        deletedByUsers: { none: { userId } },
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            // See common/users/deleted-user.ts — required for the tombstone
            // projection; omitting them leaks a deleted sender's real identity.
            accountStatus: true,
            deletedAt: true,
          },
        },
        replyTo: { select: REPLY_TO_SELECT },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
    });

    const hasMore = messages.length > take;
    const page = hasMore ? messages.slice(0, take) : messages;
    const last = page[page.length - 1];

    return {
      messages: page.map((m) =>
        this.formatMessageResponse(
          m,
          m.conversationId,
          m.conversationId,
          userId,
        ),
      ),
      hasMore,
      cursor:
        hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      syncedAt,
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

    /**
     * Reads are authorized against the match session too, not only writes.
     *
     * Ending a session deletes its messages, so this is a second lock on an
     * empty room rather than the only one — but it is the lock that makes a
     * stale client harmless. A tab still holding a dead conversation id, or
     * one rehydrating from IndexedDB and re-validating against the network,
     * gets an empty and authoritative answer instead of whatever rows
     * happened to survive. No path can rebuild an ended chat from the
     * database.
     *
     * Deliberately an empty page rather than a 403: a chat legitimately ends
     * under a user who is looking at it, and the client's job at that moment
     * is to render the "this ended" panel. An error would turn an expected
     * ending into a broken screen.
     */
    //
    // Every lookup that does not depend on another runs in one round trip. An
    // older page used to pay for four sequential stages (this lookup, the
    // participant reads, the page, then the same conversation row again for
    // its type); the conversation row is now read once, alongside the rest.
    const [instantConv, deletedForUser, currentParticipant, participants] =
      await Promise.all([
        this.prisma.conversation.findUnique({
          where: { id: realConvId },
          select: { type: true, isInstantMatch: true },
        }),
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
                joinedAt: true,
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
            // Lets the history response answer "is the other person still
            // here" for a thread the conversation list never covered — a deep
            // link, or one scrolled past the first page. Without it the
            // composer stayed enabled until a send came back refused.
            // `settings.readReceipts` is what decides whether their read time
            // and read status may be shown below. It was never selected, so
            // that check read `undefined` and always passed.
            user: {
              select: {
                accountStatus: true,
                deletedAt: true,
                settings: { select: { readReceipts: true } },
              },
            },
          },
        }),
      ]);
    if (
      instantConv &&
      (instantConv.type === 'INSTANT_MATCH' || instantConv.isInstantMatch)
    ) {
      const allowed = currentUserId
        ? await this.instantMatchGuard?.canReadChat(currentUserId, realConvId)
        : false;
      if (!allowed) {
        return {
          messages: [],
          canSendMessages: false,
          targetUserUnavailable: false,
          isMember: false,
          membershipChangedAt: null,
          participants: [],
          nextCursor: null,
        };
      }
    }

    let clearedAt: Date | null = null;
    const whereCondition: Prisma.MessageWhereInput = {
      conversationId: realConvId,
      deletedAt: null,
    };
    // Bounds on createdAt from three independent sources (the viewer leaving,
    // clearing the chat, and the page cursor), merged into one filter.
    const createdAtFilter: Prisma.DateTimeFilter<'Message'> = {};

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

    // Pagination logic
    if (typeof beforeCursor === 'string' && beforeCursor) {
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
            // See common/users/deleted-user.ts — required for the tombstone
            // projection; omitting them leaks a deleted sender's real identity.
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
    // Someone with read receipts off never counts as having read anything.
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

    // Whether this viewer may send here, answered by the same policy the write
    // path enforces with.
    //
    // The conversation list already carries this, but the list only covers the
    // first page — a thread reached by a deep link, or one that has scrolled
    // past that page, is not in it. Without this the client had no way to
    // resolve the other participant and left the composer enabled until a send
    // came back refused. History is the one response every open thread fetches,
    // so it is the right place for the answer.
    const isGroupConversation = instantConv?.type === 'GROUP';
    const canSendMessages = currentUserId
      ? await this.verificationAccess
          .assertCanMessageInConversation(
            realConvId,
            currentUserId,
            participants.filter((p) => p.leftAt == null).map((p) => p.userId),
            isGroupConversation,
          )
          .then(() => true)
          .catch(() => false)
      : false;

    // A direct thread whose only other participant is deleted is closed for
    // writes. A group stays open — the rest of its members are still there.
    const otherLiveParticipants = participants.filter(
      (p) => p.userId !== currentUserId && p.leftAt == null,
    );
    const targetUserUnavailable =
      !isGroupConversation &&
      otherLiveParticipants.length === 1 &&
      isUnavailableUser(otherLiveParticipants[0].user);

    // A former member keeps their history up to when they left, read-only.
    const isMember = !participant?.leftAt;

    return {
      messages: messagesMapped,
      canSendMessages: canSendMessages && !targetUserUnavailable && isMember,
      targetUserUnavailable,
      // The viewer's membership as the server has it now. A client whose list
      // or details cache says otherwise is behind; it keeps whichever copy has
      // the later `membershipChangedAt`.
      isMember,
      membershipChangedAt: membershipChangedAt(participant),
      // Not to a former member: the roster (who is in the group now, and when
      // each last read) is the group's, not theirs any more. Their client
      // counted it as the member count in the chat's header.
      participants: isMember
        ? participants.map((p) => ({
            userId: p.userId,
            lastReadAt:
              p.user?.settings?.readReceipts !== false ? p.lastReadAt : null,
          }))
        : [],
      nextCursor,
    };
  }

  // Bounded: one entry per partner user id, 5s TTL, LRU-evicted at 5000.
  private presenceCache = new LruCache<
    string,
    { isOnline: boolean; lastActive: string | null }
  >(5000, 5000);
  /**
   * One page of a conversation's shared photos and videos, newest first.
   *
   * Authorized exactly like the history it complements: only an active member
   * reads it, nothing before the viewer's own clear or after they left, and
   * nothing they deleted for themselves. A live instant-match room answers
   * empty for anyone the guard does not clear, as its history does.
   */
  async getConversationMedia(
    conversationId: string,
    currentUserId: string,
    beforeCursor?: string,
    limit?: number,
  ): Promise<ConversationMediaPage> {
    const take = clampMediaLimit(limit);
    const realConvId = await this.resolveConversationId(
      conversationId,
      currentUserId,
    );

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: { type: true, isInstantMatch: true },
    });
    // No conversation yet (e.g. opening the details of someone who cannot be
    // messaged): there is no media, which is an empty gallery, not an error.
    if (!conversation) return { items: [], nextCursor: null };
    if (conversation.type === 'INSTANT_MATCH' || conversation.isInstantMatch) {
      const allowed = await this.instantMatchGuard?.canReadChat(
        currentUserId,
        realConvId,
      );
      if (!allowed) return { items: [], nextCursor: null };
    }

    const [participant, deletedForUser] = await Promise.all([
      this.prisma.conversationParticipant.findFirst({
        where: {
          conversationId: realConvId,
          userId: currentUserId,
          deletedAt: null,
        },
        select: { clearedAt: true, leftAt: true },
      }),
      this.prisma.deletedMessage.findMany({
        where: {
          userId: currentUserId,
          message: { conversationId: realConvId },
        },
        select: { messageId: true },
      }),
    ]);
    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    const createdAt: Prisma.DateTimeFilter<'Message'> = {};
    if (participant.clearedAt) createdAt.gt = participant.clearedAt;
    if (participant.leftAt) createdAt.lte = participant.leftAt;

    const and: Prisma.MessageWhereInput[] = [mediaMessageFilter()];
    const cursor = parseMediaCursor(beforeCursor);
    if (cursor) {
      let position: { createdAt: Date; id: string } | null = null;
      if (cursor.kind === 'position') {
        position = cursor;
      } else {
        const row = await this.prisma.message.findUnique({
          where: { id: cursor.id },
          select: { id: true, createdAt: true },
        });
        position = row;
      }
      if (position) {
        and.push({
          OR: [
            { createdAt: { lt: position.createdAt } },
            { createdAt: position.createdAt, id: { lt: position.id } },
          ],
        });
      }
    }

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: realConvId,
        deletedAt: null,
        ...(deletedForUser.length > 0
          ? { id: { notIn: deletedForUser.map((d) => d.messageId) } }
          : {}),
        ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
        AND: and,
      },
      select: { id: true, senderId: true, createdAt: true, payload: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = page
      .map((row) => toMediaItem(row))
      .filter((item): item is ConversationMediaItem => item !== null);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? buildMediaCursor(last) : null,
    };
  }

  /**
   * @param eligibleOnly Restrict to threads that can actually be SENT into by a
   *   recipient picker. Share modals pass true; the inbox never does.
   * @param search Match the thread by the name the picker actually renders --
   *   the group's name, or the DM partner's display name / username. Applied
   *   in the QUERY, before skip/take, for the same reason every other
   *   predicate here is: a share modal that filtered the page in JavaScript
   *   could only ever find the counterparts that happened to be on the first
   *   page, so a user with more threads than the page size could not reach the
   *   rest by typing. Isolation, verification and block filters all still
   *   apply -- this narrows the eligible set, it never widens it.
   */
  /**
   * Every conversation that raises the viewer's message badge: unread, not
   * muted, and still theirs (not hidden, not left). The inbox loads one page
   * of the list, so a badge summed from that page dropped every unread chat
   * further down; the client adds these for the rows it has not loaded.
   * The same rules as the list's own count (a left group counts nothing).
   */
  async getUnreadSummary(userId: string): Promise<UnreadSummary> {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        leftAt: null,
        isMuted: false,
        unreadCount: { gt: 0 },
        conversation: { type: { in: ['DM', 'GROUP'] } },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
      take: UNREAD_SUMMARY_MAX,
      select: {
        unreadCount: true,
        conversation: { select: { id: true, publicId: true, type: true } },
      },
    });
    return {
      conversations: rows.map((r) => ({
        id: r.conversation.publicId || r.conversation.id,
        internalId: r.conversation.id,
        isGroup: r.conversation.type === 'GROUP',
        unread: r.unreadCount,
      })),
    };
  }

  async getUserConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    eligibleOnly = false,
    search?: string,
  ) {
    const cleanSearch = (search || '').trim();
    // Distinct key. The two shapes are different lists for the same user and
    // sharing one entry would let whichever call happened first decide what the
    // other saw, which in the wrong order means the inbox silently loses
    // threads.
    // The key is versioned (see conversation-list-cache.ts) and scoped by
    // viewer, which is what makes caching a filtered list safe at all.
    const cacheKey = conversationListCacheKey(
      userId,
      limit,
      offset,
      cleanSearch,
      eligibleOnly,
    );
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        // The value written below: this same list, JSON-serialized. Dates come
        // back as ISO strings, which is also exactly how the fresh list
        // reaches the client, so the response is identical either way.
        if (cached) return JSON.parse(cached) as typeof result;
      } catch {
        // A cache miss and an unreachable Redis are the same thing here: rebuild the list.
      }
    }

    const [participants, excludedUserIds, blockedByMeIds] = await Promise.all([
      this.prisma.conversationParticipant.findMany({
        where: {
          userId,
          deletedAt: null,
          // Instant Match chats are a separate product surface reached only
          // through Instant Match. They must never appear in Messages, carry
          // a preview there, or contribute to its unread badge.
          conversation: {
            type: { in: ['DM', 'GROUP'] },
            /**
             * Recipient pickers only.
             *
             * The inbox must keep every thread: history belongs to both people,
             * and a conversation disappearing because the other person's
             * verification lapsed would destroy a record the user still owns.
             * A picker is the opposite question, "who can I send this to", and
             * the send is already refused for an ineligible recipient by
             * `assertUsersEligible` — so offering the thread presents a choice
             * that can only fail. This is the same split
             * `sendableConversations` already makes for deleted accounts.
             *
             * Groups are kept regardless of any individual member's status, for
             * the same reason they are kept when a member deletes their
             * account: the thread still has people in it to receive the
             * message, and choosing a group is not choosing a person.
             *
             * Expressed as a nested filter so it is applied by the database
             * before skip/take. Dropping ineligible threads afterwards would
             * return short pages and let the offset cursor skip rows.
             */
            /**
             * BOTH rules go in `AND`, never as two spread `OR`s.
             *
             * They are each an `OR` over the same object, so spreading the
             * second would silently overwrite the first — and the one that
             * lost would be the verification filter on share pickers, with no
             * error and no test failure to say so.
             */
            AND: [
              ...(eligibleOnly
                ? [
                    {
                      OR: [
                        { type: 'GROUP' as const },
                        {
                          participants: {
                            some: {
                              userId: { not: userId },
                              user: this.verificationAccess.eligibleUserWhere(),
                            },
                          },
                        },
                      ],
                    },
                  ]
                : []),
              /**
               * The picker's search box, answered by the database.
               *
               * A thread is matched on the name the list actually shows: a
               * group by its own name, a one-to-one thread by the other
               * person's display name or username (a DM row has no stored
               * name of its own).
               *
               * `some` rather than `every`, and a positive predicate, so
               * nothing here is negated.
               *
               * Sits inside the same `AND` as the filters above, so a search
               * can only ever narrow what those already allow. A user
               * restricted by verification stays unreachable no matter what
               * is typed.
               */
              ...(cleanSearch
                ? [
                    {
                      OR: [
                        {
                          type: 'GROUP' as const,
                          name: {
                            contains: cleanSearch,
                            mode: 'insensitive' as const,
                          },
                        },
                        {
                          // DM only: a group row is rendered under its own
                          // name, so matching it on a member nobody can see in
                          // the list would look like a result out of nowhere.
                          type: 'DM' as const,
                          participants: {
                            some: {
                              userId: { not: userId },
                              leftAt: null,
                              deletedAt: null,
                              user: {
                                OR: [
                                  {
                                    displayName: {
                                      contains: cleanSearch,
                                      mode: 'insensitive' as const,
                                    },
                                  },
                                  {
                                    username: {
                                      contains: cleanSearch,
                                      mode: 'insensitive' as const,
                                    },
                                  },
                                ],
                              },
                            },
                          },
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
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
          leftGroupName: true,
          leftGroupAvatarKey: true,
          joinedAt: true,
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

    const dmConvIds = participants
      .filter((p) => p.conversation.type === 'DM')
      .map((p) => p.conversation.id);
    // The viewer's own preview for rows whose shared one is not theirs to see
    // (a group they left, a latest message they deleted for themselves). In
    // parallel with the DM partner lookup below.
    const viewerPreviewsPromise = resolveViewerPreviews(
      this.prisma,
      userId,
      participants.map((p) => ({
        conversationId: p.conversation.id,
        leftAt: p.leftAt,
        clearedAt: p.clearedAt,
        lastMessageId: p.conversation.lastMessageId,
        lastMessageAt: p.conversation.lastMessageAt,
      })),
    );
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
                  // Drives the conversation's composer state. Carried on the
                  // list payload so the chat can render its unavailable state
                  // on first paint rather than after a second round-trip.
                  verificationStatus: true,
                  // Same, for the deletion lifecycle. Omitting these renders a
                  // deleted partner's real name and avatar in the chat list.
                  accountStatus: true,
                  deletedAt: true,
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

    const viewerPreviews = await viewerPreviewsPromise;

    type DmPartner = NonNullable<(typeof dmOtherParticipants)[number]['user']>;
    const targetUserByConvId = new Map<string, DmPartner>();
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
      const uncachedIds: string[] = [];
      for (const uId of targetUserIds) {
        const cached = this.presenceCache.get(uId);
        if (cached) {
          presenceMap.set(uId, cached);
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
          this.presenceCache.set(uId, presData);
        });
      }
    }

    // Batch presence-visibility for all online, non-blocked DM partners in a
    // single pass: one viewer-settings read + at most two follow queries total,
    // replacing the previous per-conversation checkPresenceVisibility N+1.
    const visTargets: { userId: string; rule: string; isEnabled: boolean }[] =
      [];
    for (const p of participants) {
      const ou = targetUserByConvId.get(p.conversation.id);
      if (!ou || blockedSet.has(ou.id)) continue;
      // Not only online partners: `lastActive` is presence too, and an offline
      // partner's last-seen time is just as private as their online dot.
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

    // Resolved once for the whole page rather than per conversation: the
    // viewer's own status gates every row identically.
    const verificationAccess = this.verificationAccess;
    const enforcingVerification = verificationAccess.isEnforcementEnabled();
    const viewerEligible = !enforcingVerification
      ? true
      : await verificationAccess.isUserEligible(userId);

    const result = participants.map((p) => {
      const conv = p.conversation;
      const otherUser = targetUserByConvId.get(conv.id);
      // Single source for the row title, avatar, composer state and
      // target-user block, so those four cannot disagree.
      const targetUnavailable = otherUser
        ? isUnavailableUser(otherUser)
        : false;
      // `|| conv.isGroup` was here: no such column exists, so it never mattered.
      const isGroupConv = conv.type === 'GROUP';
      const seenGroup = isGroupConv
        ? groupAsSeenBy(p, {
            name: conv.name,
            avatarKey: conv.avatarKey,
            description: conv.description,
            memberCount: conv._count?.participants || 0,
          })
        : null;

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
      // A group the viewer is no longer in counts nothing: they cannot open
      // what arrived, and unread from before they left could never be cleared.
      const unreadCount = p.leftAt ? 0 : p.unreadCount || 0;

      // The preview this viewer may see: the shared one, or their own where
      // that is not theirs (viewer-preview.ts). Clear is per-user too: left
      // unguarded, a user who cleared the chat still saw the other person's
      // last message sitting in their list row, quoting content that no
      // longer exists for them anywhere else. Anything at or before this
      // user's own cutoff is hidden; the next message they actually receive
      // is after it and shows normally.
      const visible = viewerPreviews.has(conv.id)
        ? viewerPreviews.get(conv.id)
        : conv.lastMessageAt
          ? {
              id: conv.lastMessageId || null,
              createdAt: conv.lastMessageAt,
              senderId: conv.lastMessageSenderId || '',
              text: conv.lastMessageText || '',
              type: conv.lastMessageType
                ? conv.lastMessageType.toLowerCase()
                : 'chat',
            }
          : null;
      const previewCleared = Boolean(
        visible && p.clearedAt && visible.createdAt <= p.clearedAt,
      );

      const resolvedLastMsg =
        visible && !previewCleared
          ? {
              id: visible.id,
              createdAt: visible.createdAt,
              senderId: visible.senderId,
              senderName: visible.senderId === userId ? 'You' : '',
              text: visible.text,
              type: visible.type,
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
        membershipChangedAt: membershipChangedAt(p),
        ownerId: conv.ownerId || null,
        isGroup: isGroupConv,
        name: seenGroup
          ? seenGroup.name
          : conv.name || presentUserName(otherUser) || 'Chat',
        avatar: seenGroup
          ? seenGroup.avatar
          : conv.avatarKey || presentUserAvatar(otherUser) || null,
        description: seenGroup
          ? seenGroup.description
          : conv.description || null,
        status: conv.status || 'ACTIVE',
        isInstantMatch: conv.isInstantMatch || false,
        expiresAt: conv.expiresAt || null,
        createdAt: conv.createdAt,
        // Frozen at the moment a former member left, so the row neither dates
        // nor sorts itself by activity they can no longer see.
        updatedAt: viewerUpdatedAt(conv.updatedAt, p.leftAt),
        whoCanJoin: conv.whoCanJoin || 'ANYONE',
        visibility: conv.visibility || 'PUBLIC',
        allowSharing: conv.allowSharing !== false,
        editGroupPermission: conv.editGroupPermission || 'ADMIN',
        groupUpdatesActive: p.groupUpdatesActive !== false,
        pendingRequests: [],
        admins: [],
        members: [],
        // The `memberCount` column was also read here as a fallback, but this
        // query never selects it, so the count has always been `_count`.
        memberCount: seenGroup ? seenGroup.memberCount : 0,
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
        // Whether *this* viewer may send into this thread right now, judged
        // by the one policy the backend enforces with. The client mirrors it
        // to disable the composer; it is not the enforcement itself.
        canSendMessages: isGroupConv
          ? viewerEligible && !p.leftAt
          : !targetUnavailable &&
            viewerEligible &&
            (!enforcingVerification ||
              !otherUser ||
              verificationAccess.isEligibleStatus(
                otherUser.verificationStatus,
              )),
        targetUserUnavailable: targetUnavailable,
        targetUser: otherUser
          ? {
              id: otherUser.id,
              username: targetUnavailable
                ? DELETED_USER_USERNAME
                : otherUser.username,
              displayName: presentUserName(otherUser),
              avatar: presentUserAvatar(otherUser),
              isDeleted: targetUnavailable,
              profileAvailable: !targetUnavailable,
              verificationStatus: targetUnavailable
                ? 'UNVERIFIED'
                : otherUser.verificationStatus,
              isOnline: targetUnavailable
                ? false
                : canSeeOnline
                  ? userPresence?.isOnline || false
                  : false,
              lastActive:
                targetUnavailable || !presenceVisibleSet.has(otherUser.id)
                  ? null
                  : userPresence?.lastActive || null,
            }
          : null,
      };
    });

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
    // A 1:1 start is find-then-create under READ COMMITTED, so two
    // simultaneous first contacts could each create a DM. Serialise per user
    // pair (sorted, so A->B and B->A share one lock).
    const others = [
      ...new Set((userIds || []).filter((id) => id && id !== currentUserId)),
    ];
    if (others.length === 1 && !groupName) {
      return withDmCreateLock(this.redisService, currentUserId, others[0], () =>
        this.startConversationUnlocked(userIds, currentUserId, groupName),
      );
    }
    return this.startConversationUnlocked(userIds, currentUserId, groupName);
  }

  private async startConversationUnlocked(
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
        const pubId = existing.publicId || existing.id;
        return { id: pubId, publicId: pubId };
      }
    }

    // Verification gate, placed *after* the existing-conversation lookup above
    // on purpose: returning the id of a thread that already exists is how the
    // UI opens its history, which stays allowed. What is gated is the create
    // below — no new conversation row is written for a pair (or group) that is
    // not currently allowed to talk, so clicking Message never leaves an empty
    // orphan behind.
    await this.verificationAccess.assertUsersEligible(
      [currentUserId, ...filteredUserIds],
      currentUserId,
    );

    // Placed here for exactly the reason the verification gate above is: the
    // existing-conversation branch returned already, so this charges only for
    // a genuine first contact. Charging before that lookup would spend a point
    // every time someone reopened a thread they already had, and at 15/hour
    // ordinary use would start failing.
    await assertNewConversationWithinRateLimit(
      this.rateLimit,
      currentUserId,
      Boolean(groupName),
    );

    const participants = [...new Set([...filteredUserIds, currentUserId])].map(
      (id) => ({
        userId: id,
        role: id === currentUserId ? ('OWNER' as const) : ('MEMBER' as const),
      }),
    );

    const newPubId = generatePublicId();
    await this.prisma.conversation.create({
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
    // Participant, block and verification rules live in the core service.
    return super.reactToMessage(messageId, userId, reaction);
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
    // The active-participant check lives in the core service.
    return super.deleteMessageForMe(messageId, userId);
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

    const forwarded: Awaited<ReturnType<MessagesService['sendMessage']>>[] = [];
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

    if (!participant || participant.leftAt) {
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

    let updated: Conversation;
    let participantRows: { userId: string }[];
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

    this.mediaCleanupService?.replaceEntityMedia({
      entityType: 'GROUP_AVATAR',
      entityId: realConvId,
      previous: conversation?.avatarKey,
      next: updated.avatarKey,
      ownerId: userId,
      submitted: avatarVal !== undefined,
    });

    void this.invalidateUserConversationsCache(
      participantRows.map((p) => p.userId),
    );

    return updated;
  }

  async createInstantMatchConversation(
    userAId: string,
    userBId: string,
    _activity: string,
  ): Promise<{ id: string; internalId: string; expiresAt: number }> {
    if (!userAId || !userBId || userAId === userBId) {
      throw new BadRequestException('Invalid instant match participants');
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Deliberately no reuse lookup.
    //
    // This used to hand back any INSTANT_MATCH conversation between the same
    // two users that was still inside its 24h window. That made the pair —
    // not the match session — the identity of the chat, so two people who
    // matched, talked, ended the session and matched again within the same
    // day were dropped back into the *old* thread with the *old* messages.
    // An Instant Match conversation belongs to exactly one session and is
    // never shared with another, so every accepted session opens its own.

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

  async updateGroupSettings(
    conversationId: string,
    userId: string,
    data: UpdateGroupSettingsDto,
  ) {
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
    const settingsData = pickGroupSettings(data);

    if (Object.keys(settingsData).length > 0) {
      assertGroupAuthority(
        participant,
        ['OWNER', 'ADMIN'],
        'Only group admins can update these settings',
      );
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
    assertGroupAuthority(
      participant,
      ['OWNER', 'ADMIN'],
      'Only group admins can update settings',
    );
    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { editGroupPermission: permission },
    });
    return { success: true };
  }

  // changeGroupOwner / promoteToAdmin / demoteFromAdmin / endGroup and the
  // join-request decisions (acceptGroupJoinRequest / declineGroupJoinRequest)
  // are inherited from MessagingCoreService (single source of truth).

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
    /**
     * `createdAt`: the line's own time (a departure's line is written at the
     * departure, so the departed member's history, which ends there, keeps
     * it). `event`: what happened, in a form the app reads (see
     * group-departure-announce.util.ts); the text stays for older apps.
     */
    options: { createdAt?: Date; event?: GroupDepartureEvent } = {},
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
        payload: options.event ? { text, event: options.event } : { text },
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
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
      payload: options.event ? { text, event: options.event } : { text },
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
