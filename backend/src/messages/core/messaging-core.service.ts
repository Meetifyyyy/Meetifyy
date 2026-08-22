import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { MentionSource, NotificationEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { MentionsService } from '../../mentions/mentions.service';
import { buildReplyToSnapshot, REPLY_TO_SELECT } from '../reply-preview.util';

@Injectable()
export class MessagingCoreService {
  /**
   * Short-lived in-process cache: publicId/actId → internalUUID.
   * Conversation IDs are immutable after creation, so a 30s TTL is safe.
   * This eliminates 1–3 DB queries from every messaging endpoint call.
   * Modelled on Discord's conversation ID resolution layer.
   */
  private readonly convIdCache = new Map<string, { id: string; expiresAt: number }>();
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
  ) { }

  async getBatchUnblockedAndUnmutedParticipants(conversationId: string, senderId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, deletedAt: null },
      select: { userId: true, isMuted: true }
    });

    const otherIds = participants.map(p => p.userId).filter(id => id !== senderId);
    if (otherIds.length === 0) {
      return { recipientIds: [], unmutedRecipientIds: [] };
    }

    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: senderId, blockedId: { in: otherIds } },
          { blockerId: { in: otherIds }, blockedId: senderId }
        ]
      },
      select: { blockerId: true, blockedId: true }
    });
    const blockedUserSet = new Set(blocks.flatMap(b => [b.blockerId, b.blockedId]));

    const unblockedIds = otherIds.filter(id => !blockedUserSet.has(id));
    const muteMap = new Map(participants.map(p => [p.userId, p.isMuted]));
    const unmutedIds = unblockedIds.filter(id => !muteMap.get(id));

    return { recipientIds: unblockedIds, unmutedRecipientIds: unmutedIds };
  }

  async resolveConversationId(identifier: string, currentUserId?: string): Promise<string> {
    if (!identifier) return identifier;
    const cleanId = String(identifier).replace(/^(act_)+/, '');

    // Fast path: return cached mapping if still fresh
    const cached = this.convIdCache.get(identifier) ?? this.convIdCache.get(cleanId);
    if (cached && cached.expiresAt > Date.now()) return cached.id;

    const cacheResult = (id: string) => {
      const entry = { id, expiresAt: Date.now() + MessagingCoreService.CONV_CACHE_TTL_MS };
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

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);

    try {
      let conv = null;
      if (isUuid) {
        conv = await this.prisma.conversation.findUnique({
          where: { id: cleanId },
          select: { id: true }
        });
      } else {
        conv = await this.prisma.conversation.findUnique({
          where: { publicId: cleanId },
          select: { id: true }
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
              { participants: { some: { userId: identifier } } }
            ]
          },
          select: { id: true }
        });
        if (dm?.id) {
          cacheResult(dm.id);
          return dm.id;
        }
      }
    } catch (err) {
      // ignore transient errors, return identifier as-is
    }
    return identifier;
  }

  async sendMessage(
    senderId: string,
    conversationId: string,
    payload: SendMessageDto
  ): Promise<MessageResponseDto & { recipientIds: string[]; unmutedRecipientIds: string[]; conversationName: string }> {
    const realConvId = await this.resolveConversationId(conversationId, senderId);

    // 1. Fetch conversation details & active participants in a single query
    const conv = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: {
        id: true,
        publicId: true,
        name: true,
        participants: {
          // `deletedAt` is deliberately NOT filtered here. A participant who
          // deleted this conversation is still a member of it — they simply
          // hid it. New activity brings it back (see the revive below), so
          // they must stay in the recipient set; filtering them out silently
          // dropped every message sent to someone who had ever cleared the
          // thread. `leftAt` is different: that user really is gone.
          where: { leftAt: null },
          select: { userId: true, isMuted: true }
        }
      }
    });

    if (!conv) {
      throw new ForbiddenException('Conversation not found');
    }

    const myParticipant = conv.participants.find(p => p.userId === senderId);
    if (!myParticipant) {
      throw new ForbiddenException('You are no longer a member of this conversation');
    }

    const otherParticipants = conv.participants.filter(p => p.userId !== senderId);
    const otherUserIds = otherParticipants.map(p => p.userId);
    const participantIdSet = new Set(conv.participants.map(p => p.userId));

    // Re-derive the true mention set from the actual message text, then
    // restrict it to real conversation participants — mentioning someone
    // outside the conversation must never leak a notification (with message
    // preview text) to a user who has no access to this thread.
    const sanitizedMentions = (await this.mentionsService.sanitize(payload.text || '', payload.mentions, senderId))
      .filter(m => participantIdSet.has(m.userId));

    let recipientIds: string[] = [];
    let unmutedRecipientIds: string[] = [];

    if (otherUserIds.length > 0) {
      const blocks = await this.prisma.block.findMany({
        where: {
          OR: [
            { blockerId: senderId, blockedId: { in: otherUserIds } },
            { blockerId: { in: otherUserIds }, blockedId: senderId }
          ]
        },
        select: { blockerId: true, blockedId: true }
      });

      const blockedUserSet = new Set(blocks.flatMap(b => [b.blockerId, b.blockedId]));
      const isBlockedByMe = blocks.some(b => b.blockerId === senderId);
      if (isBlockedByMe) {
        throw new ForbiddenException('Unblock this contact to send a message');
      }

      recipientIds = otherUserIds.filter(id => !blockedUserSet.has(id));
      const muteMap = new Map(conv.participants.map(p => [p.userId, p.isMuted]));
      unmutedRecipientIds = recipientIds.filter(id => !muteMap.get(id));
    }

    const type = payload.mediaUrl || payload.mediaType ? ('MEDIA' as const) : ('CHAT' as const);

    let validatedReplyToId: string | null = null;
    if (payload.replyToId) {
      const replyTarget = await this.prisma.message.findFirst({
        where: {
          id: payload.replyToId,
          conversationId: realConvId
        },
        select: { id: true }
      });
      validatedReplyToId = replyTarget ? replyTarget.id : null;
    }

    let initialInviteData = payload.inviteData || null;
    if (initialInviteData && (initialInviteData.type === 'group_invite' || initialInviteData.groupId || initialInviteData.conversationId)) {
      const expiresAt = initialInviteData.expiresAt || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const isExpired = new Date(expiresAt).getTime() <= Date.now();
      initialInviteData = {
        ...initialInviteData,
        expiresAt,
        isExpired
      };
    }

    const now = new Date();
    const lastMsgText = payload.text ||
      (initialInviteData?.type === 'postShare' ? 'Shared a post' : null) ||
      (initialInviteData?.groupName ? `Group invite: ${initialInviteData.groupName}` : null) ||
      (payload.mediaUrl ? (payload.mediaType === 'image' ? 'Photo' : payload.mediaType === 'video' ? 'Video' : 'Audio') : 'Message');

    // 2. Atomic $transaction for message creation and conversation metadata updates
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: realConvId,
          senderId,
          type,
          replyToId: validatedReplyToId,
          payload: {
            text: payload.text || '',
            mediaUrl: payload.mediaUrl || null,
            mediaType: payload.mediaType || null,
            // Lightweight media metadata for instant, layout-stable rendering on
            // the recipient side (thumbnail/poster + intrinsic dimensions/duration).
            thumbnailUrl: payload.thumbnailUrl || null,
            width: payload.width || null,
            height: payload.height || null,
            duration: payload.duration || null,
            mentions: sanitizedMentions,
            inviteData: initialInviteData,
            isForwarded: payload.isForwarded || false,
            forwardedFromMessageId: payload.forwardedFromMessageId || null,
          } as any,
        },
        include: {
          sender: {
            select: { id: true, username: true, displayName: true, avatar: true }
          },
          replyTo: { select: REPLY_TO_SELECT }
        }
      }),
      this.prisma.conversation.update({
        where: { id: realConvId },
        data: {
          updatedAt: now,
          lastMessageText: lastMsgText,
          lastMessageType: type,
          lastMessageAt: now,
          lastMessageSenderId: senderId,
        }
      }),
      ...(otherUserIds.length > 0 ? [
        this.prisma.conversationParticipant.updateMany({
          where: { conversationId: realConvId, userId: { not: senderId }, leftAt: null },
          data: { unreadCount: { increment: 1 } }
        })
      ] : []),
      // New activity revives the conversation for anyone who had deleted it —
      // sender included, since sending into a thread you deleted is an
      // unambiguous request to have it back. `clearedAt` is deliberately left
      // alone: the thread returns, its old messages do not.
      this.prisma.conversationParticipant.updateMany({
        where: { conversationId: realConvId, leftAt: null, deletedAt: { not: null } },
        data: { deletedAt: null }
      })
    ]);

    const isUnsent = message.state === 'UNSENT';
    const msgPayload = (message.payload as any) || {};
    let outputInviteData = isUnsent ? null : (msgPayload.inviteData || null);
    if (outputInviteData && (outputInviteData.type === 'group_invite' || outputInviteData.groupId || outputInviteData.conversationId)) {
      const createdAtMs = message.createdAt ? new Date(message.createdAt).getTime() : Date.now();
      const expiresAt = outputInviteData.expiresAt || new Date(createdAtMs + 48 * 60 * 60 * 1000).toISOString();
      const isExpired = new Date(expiresAt).getTime() <= Date.now();
      outputInviteData = { ...outputInviteData, expiresAt, isExpired };
    }

    let replyToObj: any = null;
    if (message.replyTo) {
      replyToObj = buildReplyToSnapshot(message.replyTo, senderId);
    }

    const pubId = conv.publicId || conversationId;

    // Fire-and-forget: must never add latency to message delivery, and a
    // notification failure must never roll back the already-committed message.
    if (sanitizedMentions.length > 0 && message.sender && !isUnsent) {
      this.mentionsService.persistAndNotify({
        mentions: sanitizedMentions,
        sourceType: MentionSource.MESSAGE,
        sourceId: message.id,
        actor: message.sender,
        entityType: NotificationEntityType.MESSAGE,
        entityId: pubId,
        contextText: payload.text || '',
        extraMetadata: { conversationId: pubId, internalConversationId: realConvId },
      }).catch(err => this.coreLogger.warn('Failed to process message mentions', err));
    }

    return {
      id: message.id,
      conversationId: pubId,
      publicId: pubId,
      internalId: realConvId,
      senderId: message.senderId,
      senderName: message.sender?.displayName || message.sender?.username || 'User',
      senderAvatar: message.sender?.avatar || '',
      createdAt: message.createdAt,
      timestamp: message.createdAt,
      time: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: message.type ? message.type.toLowerCase() : 'chat',
      state: message.state || 'SENT',
      isUnsent,
      payload: isUnsent ? { text: 'This message was unsent' } : msgPayload,
      text: isUnsent ? 'This message was unsent' : (msgPayload.text || ''),
      mediaUrl: isUnsent ? null : (msgPayload.mediaUrl || null),
      mediaType: isUnsent ? null : (msgPayload.mediaType || null),
      mentions: isUnsent ? [] : (msgPayload.mentions || []),
      inviteData: outputInviteData,
      replyTo: isUnsent ? null : replyToObj,
      status: 'sent',
      recipientIds,
      unmutedRecipientIds,
      conversationName: conv.name || '',
    };
  }

  async getConversationHistory(
    conversationId: string,
    currentUserId?: string,
    beforeCursor?: string,
    limit: number = 50
  ) {
    const realConvId = await this.resolveConversationId(conversationId, currentUserId);
    let clearedAt: Date | null = null;
    const whereCondition: any = {
      conversationId: realConvId,
      deletedAt: null
    };

    const [deletedForUser, participant, blocksMade, participants] = await Promise.all([
      currentUserId ? this.prisma.deletedMessage.findMany({
        where: { userId: currentUserId, message: { conversationId: realConvId } },
        select: { messageId: true }
      }) : Promise.resolve([]),
      currentUserId ? this.prisma.conversationParticipant.findFirst({
        where: { userId: currentUserId, conversationId: realConvId }
      }) : Promise.resolve(null),
      currentUserId ? this.prisma.block.findMany({
        where: { blockerId: currentUserId },
        select: { blockedId: true }
      }) : Promise.resolve([]),
      this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, deletedAt: null },
        select: { userId: true, lastReadAt: true, user: { select: { settings: { select: { readReceipts: true } } } } }
      })
    ]);

    if (deletedForUser && deletedForUser.length > 0) {
      whereCondition.id = { notIn: deletedForUser.map(d => d.messageId) };
    }

    if (participant) {
      clearedAt = participant.clearedAt;
      const pLeftAt = (participant as any).leftAt;
      if (pLeftAt) {
        whereCondition.createdAt = { lte: pLeftAt };
      }
    }

    if (blocksMade && blocksMade.length > 0) {
      whereCondition.NOT = {
        senderId: { in: blocksMade.map(b => b.blockedId) }
      };
    }

    if (clearedAt) {
      whereCondition.createdAt = { ...(whereCondition.createdAt || {}), gt: clearedAt };
    }

    const orConditions: any[] = [];


    if (beforeCursor) {
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
          select: { id: true, createdAt: true }
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
              { createdAt: cursorDate, id: { lt: cursorId } }
            ]
          });
        } else {
          whereCondition.createdAt = {
            ...(typeof whereCondition.createdAt === 'object' ? whereCondition.createdAt : {}),
            lt: cursorDate
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
          select: { id: true, username: true, displayName: true, avatar: true }
        },
        replyTo: { select: REPLY_TO_SELECT }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }
    messages.reverse();
    const realDbMessages = messages.filter(m => !m.id.startsWith('sys_'));
    const oldestRealMessage = realDbMessages[0];
    // Use timestamp|id cursor so the server can seek with a pure index scan
    // (no findUnique DB lookup per page). Matches MessagesService format.
    const nextCursor = hasMore && oldestRealMessage
      ? (oldestRealMessage.createdAt
        ? `${new Date(oldestRealMessage.createdAt).toISOString()}|${oldestRealMessage.id}`
        : oldestRealMessage.id)
      : null;
    const otherParticipants = participants.filter(p => currentUserId && p.userId !== currentUserId);
    const otherReadTimestamps = otherParticipants
      .filter(p => p.user?.settings?.readReceipts !== false && p.lastReadAt != null)
      .map(p => new Date(p.lastReadAt!).getTime());

    const isAllRead = otherReadTimestamps.length > 0 && otherReadTimestamps.length === otherParticipants.length;
    const minOtherLastReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;

    const messagesMapped = messages.map(m => {
      const payload = (m.payload as any) || {};

      let replyToObj: any = null;
      if (m.replyTo) {
        replyToObj = buildReplyToSnapshot(m.replyTo, currentUserId);
      }

      const isRead = currentUserId && m.senderId === currentUserId && isAllRead && (minOtherLastReadAt + 5000 >= new Date(m.createdAt).getTime());
      const isUnsent = m.state === 'UNSENT';

      let inviteData = isUnsent ? null : (payload.inviteData || null);
      if (inviteData && (inviteData.type === 'group_invite' || inviteData.groupId || inviteData.conversationId)) {
        const createdAtMs = m.createdAt ? new Date(m.createdAt).getTime() : Date.now();
        const expiresAt = inviteData.expiresAt || new Date(createdAtMs + 48 * 60 * 60 * 1000).toISOString();
        const isExpired = new Date(expiresAt).getTime() <= Date.now();
        inviteData = { ...inviteData, expiresAt, isExpired };
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
        time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        type: m.type ? m.type.toLowerCase() : 'chat',
        payload: isUnsent ? { text: 'This message was unsent' } : payload,
        text: isUnsent ? 'This message was unsent' : (payload.text || ''),
        mediaUrl: isUnsent ? null : (payload.mediaUrl || null),
        mediaType: isUnsent ? null : (payload.mediaType || null),
        mentions: isUnsent ? [] : (payload.mentions || []),
        inviteData,
        replyTo: isUnsent ? null : replyToObj,
        status: isRead ? 'read' : 'sent',
        state: m.state || 'SENT',
        isUnsent
      };
    });

    return {
      messages: messagesMapped,
      participants: participants.map(p => ({
        userId: p.userId,
        lastReadAt: p.user?.settings?.readReceipts !== false ? p.lastReadAt : null
      })),
      nextCursor
    };
  }

  /**
   * Write-behind read receipt (WhatsApp/Slack pattern): acknowledge instantly,
   * do the DB write + fan-out to OTHER participants in setImmediate so the
   * caller's response is never blocked on it. Shared by all three messaging
   * services (DM / group / unified) so every read endpoint is equally fast and
   * correctly notifies the other side.
   */
  async markAsRead(conversationId: string, userId: string): Promise<{ success: boolean }> {
    setImmediate(() => void this._persistMarkAsRead(conversationId, userId));
    return { success: true };
  }

  protected async _persistMarkAsRead(conversationId: string, userId: string): Promise<void> {
    try {
      const realConvId = await this.resolveConversationId(conversationId, userId);

      const conv = await this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { id: true }
      });
      if (!conv) return;

      const now = new Date();
      await this.prisma.conversationParticipant.upsert({
        where: { userId_conversationId: { userId, conversationId: realConvId } },
        update: { lastReadAt: now, unreadCount: 0 },
        create: { userId, conversationId: realConvId, lastReadAt: now, unreadCount: 0 }
      }).catch(() => {});

      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, deletedAt: null },
        select: { userId: true, lastReadAt: true, user: { select: { settings: { select: { readReceipts: true } } } } }
      });

      const readerParticipant = participants.find(p => p.userId === userId);
      if (readerParticipant?.user?.settings?.readReceipts === false) return;

      for (const p of participants) {
        if (p.userId === userId) continue;
        const others = participants.filter(item => item.userId !== p.userId);
        const otherReadTimestamps = others
          .filter(item => item.user?.settings?.readReceipts !== false && item.lastReadAt != null)
          .map(item => new Date(item.lastReadAt!).getTime());

        const isAllRead = otherReadTimestamps.length > 0 && otherReadTimestamps.length === others.length;
        const minOtherReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;

        this.domainEventService.emit('conversation:seen', {
          conversationId,
          realConvId,
          readerId: userId,
          lastReadAt: now.toISOString(),
          isAllRead,
          minOtherReadAt: minOtherReadAt ? new Date(minOtherReadAt).toISOString() : null
        }, [p.userId]);
      }
    } catch (err) {
      this.coreLogger.warn(`markAsRead background write failed: ${(err as Error)?.message}`);
    }
  }

  async reactToMessage(messageId: string, userId: string, reaction: string) {
    await this.prisma.messageReaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji: reaction
        }
      },
      update: {},
      create: {
        messageId,
        userId,
        emoji: reaction
      }
    });
    return { success: true };
  }

  async unsendMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        createdAt: true,
        state: true,
        conversation: {
          select: {
            id: true,
            publicId: true,
            lastMessageId: true,
            participants: {
              where: { leftAt: null, deletedAt: null },
              select: { userId: true }
            }
          }
        }
      }
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only unsend your own messages');
    }

    const diffMins = (Date.now() - new Date(message.createdAt).getTime()) / (1000 * 60);
    if (diffMins > 10) {
      throw new BadRequestException('Messages can only be unsent within 10 minutes of sending');
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        state: 'UNSENT',
        replyToId: null,
        payload: {
          text: 'This message was unsent',
          mediaUrl: null,
          mediaType: null,
          inviteData: null,
          isForwarded: false
        }
      }
    });

    if (message.conversation?.lastMessageId === messageId) {
      await this.prisma.conversation.update({
        where: { id: message.conversationId },
        data: { lastMessageText: 'This message was unsent' }
      }).catch(() => { });
    }

    const participantIds = message.conversation?.participants?.map(p => p.userId) || [];
    const publicId = message.conversation?.publicId || message.conversationId;

    return {
      success: true,
      id: message.id,
      messageId: message.id,
      conversationId: message.conversationId,
      publicId,
      participantIds,
      state: 'UNSENT'
    };
  }

  async deleteMessageForMe(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true }
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.prisma.deletedMessage.upsert({
      where: { userId_messageId: { userId, messageId } },
      create: { userId, messageId },
      update: {}
    });

    return { success: true, messageId: message.id, conversationId: message.conversationId };
  }

  async forwardMessage(messageId: string, targetConversationIds: string[], userId: string) {
    const originalMsg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, payload: true, type: true }
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
        const isParticipant = await this.prisma.conversationParticipant.findFirst({
          where: { userId, conversationId: realConvId, deletedAt: null }
        });
        if (!isParticipant) return null;

        return this.sendMessage(userId, realConvId, {
          text,
          mediaUrl,
          mediaType,
          replyToId: undefined,
          mentions: [],
          isForwarded: true,
          forwardedFromMessageId: messageId
        });
      });

      const results = await Promise.all(promises);
      results.forEach(msg => {
        if (msg) forwarded.push(msg);
      });
    }

    return { success: true, count: forwarded.length, messages: forwarded };
  }

  async muteConversation(conversationId: string, userId: string, muted: boolean) {
    const realConvId = await this.resolveConversationId(conversationId);
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      data: { isMuted: muted }
    });
    return { success: true, muted };
  }

  async pinConversation(conversationId: string, userId: string, pinned: boolean) {
    const realConvId = await this.resolveConversationId(conversationId);
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      data: { isPinned: pinned }
    });
    return { success: true, pinned };
  }

  async clearChatForUser(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      data: { clearedAt: new Date() }
    });
    return { success: true };
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
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      data: { deletedAt: now, clearedAt: now }
    });
    return { success: true };
  }

  // ─── Canonical group role/ownership operations ─────────────────────────────
  // Single source of truth shared by MessagesService and GroupChatsService
  // (both extend this base). Each validates the actor's authority AND that the
  // target is an active member, so a bad targetUserId yields a clean 404 rather
  // than a raw Prisma "record not found" 500.

  async changeGroupOwner(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const [participant, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId, conversationId: realConvId } }
      }),
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } }
      })
    ]);
    if (!participant || participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can transfer ownership');
    }
    if (!target || (target as any).leftAt || target.deletedAt) {
      throw new NotFoundException('Target user is not a member of this group');
    }
    await this.prisma.$transaction([
      this.prisma.conversationParticipant.update({
        where: { userId_conversationId: { userId, conversationId: realConvId } },
        data: { role: 'ADMIN' }
      }),
      this.prisma.conversationParticipant.update({
        where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } },
        data: { role: 'OWNER' }
      }),
      this.prisma.conversation.update({
        where: { id: realConvId },
        data: { ownerId: targetUserId }
      })
    ]);
    return { success: true };
  }

  async promoteToAdmin(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const [participant, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId, conversationId: realConvId } }
      }),
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } }
      })
    ]);
    if (!participant || participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can promote admins');
    }
    if (!target || (target as any).leftAt || target.deletedAt) {
      throw new NotFoundException('Target user is not a member of this group');
    }
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } },
      data: { role: 'ADMIN' }
    });
    return { success: true };
  }

  async demoteFromAdmin(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const [participant, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId, conversationId: realConvId } }
      }),
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } }
      })
    ]);
    if (!participant || participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can demote admins');
    }
    if (!target || (target as any).leftAt || target.deletedAt) {
      throw new NotFoundException('Target user is not a member of this group');
    }
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } },
      data: { role: 'MEMBER' }
    });
    return { success: true };
  }

  async endGroup(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can end the group');
    }
    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { status: 'Closed' }
    });
    return { success: true };
  }

  async createSystemMessage(conversationId: string, senderId: string, text: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const message: any = await this.prisma.message.create({
      data: {
        conversationId: realConvId,
        senderId,
        type: 'SYSTEM',
        payload: { text }
      },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatar: true }
        }
      }
    });

    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { updatedAt: new Date() }
    });

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName: message.sender?.displayName || message.sender?.username || 'System',
      senderAvatar: message.sender?.avatar || '',
      createdAt: message.createdAt,
      timestamp: message.createdAt,
      time: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'system',
      payload: { text },
      text,
      status: 'sent'
    };
  }

  async getConversationParticipantIds(conversationId: string): Promise<string[]> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, leftAt: null, deletedAt: null } as any,
      select: { userId: true },
    });
    return participants.map(p => p.userId);
  }

  async getGroupUpdatesParticipantIds(conversationId: string): Promise<string[]> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, leftAt: null, deletedAt: null, groupUpdatesActive: true } as any,
      select: { userId: true },
    });
    return participants.map(p => p.userId);
  }

  async getConversationById(conversationId: string) {
    const realId = await this.resolveConversationId(conversationId);
    return this.prisma.conversation.findUnique({
      where: { id: realId },
      include: {
        avatarMedia: true,
      }
    });
  }

  async getUserHandle(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true }
    });
    if (!user) return 'Someone';
    const rawName = user.username || user.displayName || 'Someone';
    return rawName.startsWith('@') ? rawName : `@${rawName}`;
  }

  async isUserBlockedBy(userId: string, targetUserId: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: { blockerId: targetUserId, blockedId: userId }
    });
    return !!block;
  }

  async isUserConversationMuted(conversationId: string, userId: string): Promise<boolean> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      select: { isMuted: true }
    });
    return participant?.isMuted || false;
  }
}
