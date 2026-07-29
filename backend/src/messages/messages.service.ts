import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Inject, forwardRef, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { generatePublicId } from '../common/utils/public-id.util';
import { MessagingCoreService } from './core/messaging-core.service';

@Injectable()
export class MessagesService extends MessagingCoreService implements OnModuleInit, OnModuleDestroy {
  private instantMatchCleanupTimer?: NodeJS.Timeout;
  protected readonly logger = new Logger(MessagesService.name);

  constructor(
    prisma: PrismaService,
    presenceService: PresenceService,
    domainEventService: DomainEventService,
  ) {
    super(prisma, presenceService, domainEventService);
  }

  async onModuleInit() {
    await this.cleanupExpiredInstantMatches();
    this.instantMatchCleanupTimer = setInterval(
      () => void this.cleanupExpiredInstantMatches(),
      15 * 60 * 1000,
    );
    this.instantMatchCleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.instantMatchCleanupTimer) clearInterval(this.instantMatchCleanupTimer);
  }

  private async cleanupExpiredInstantMatches() {
    try {
      await this.prisma.conversation.deleteMany({
        where: { isInstantMatch: true, expiresAt: { lt: new Date() } },
      });
    } catch (error) {
      this.logger.warn(`Expired instant-match cleanup failed: ${(error as Error).message}`);
    }
  }

  private resolveCache = new Map<string, { id: string; timestamp: number }>();

  async resolveConversationId(identifier: string, currentUserId?: string): Promise<string> {
    if (!identifier) return identifier;
    const cleanId = String(identifier).replace(/^(act_)+/, '');

    const cacheKey = `${identifier}:${currentUserId || ''}`;
    const cached = this.resolveCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 86400000) { // 24-hour TTL
      return cached.id;
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
    if (isUuid) {
      const directConv = await this.prisma.conversation.findUnique({
        where: { id: cleanId },
        select: { id: true }
      });
      if (directConv?.id) {
        this.resolveCache.set(cacheKey, { id: directConv.id, timestamp: Date.now() });
        return directConv.id;
      }
    }
    try {
      const conv = await this.prisma.conversation.findFirst({
        where: {
          OR: [
            { id: identifier },
            { publicId: identifier },
            { id: cleanId },
            { publicId: cleanId },
            { activityId: cleanId },
          ]
        },
        select: { id: true }
      });
      if (conv?.id) {
        this.resolveCache.set(cacheKey, { id: conv.id, timestamp: Date.now() });
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
          this.resolveCache.set(cacheKey, { id: dm.id, timestamp: Date.now() });
          return dm.id;
        }
      }
    } catch (err) {
      // ignore
    }
    return identifier;
  }

  async saveEncryptedMessage(senderId: string, senderDeviceId: string, conversationId: string, targets: any[]) {
    const realConvId = await this.resolveConversationId(conversationId);
    let conv = await this.prisma.conversation.findUnique({ where: { id: realConvId } });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: realConvId,
        senderId,
        senderDeviceId,
        type: 'CHAT',
        targets: {
          create: targets.map(t => ({
            deviceId: t.deviceId,
            type: t.type,
            ciphertext: t.ciphertext
          }))
        }
      },
      include: { targets: true }
    });

    return message;
  }

  async sendMessage(
    senderId: string,
    conversationId: string,
    payload: {
      text?: string;
      mediaUrl?: string;
      mediaType?: string;
      mentions?: string[];
      replyToId?: string;
      inviteData?: any;
      isForwarded?: boolean;
      forwardedFromMessageId?: string;
      tempId?: string;
    }
  ) {
    const realConvId = await this.resolveConversationId(conversationId);

    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, deletedAt: null },
      select: { userId: true, leftAt: true }
    });

    const senderParticipant = participants.find(p => p.userId === senderId);
    if (!senderParticipant || senderParticipant.leftAt) {
      throw new ForbiddenException('You are no longer a member of this group');
    }

    const otherUserIds = participants.filter(p => p.userId !== senderId).map(p => p.userId);
    if (otherUserIds.length > 0) {
      const isBlockedByMe = await this.prisma.block.findFirst({
        where: { blockerId: senderId, blockedId: { in: otherUserIds } }
      });
      if (isBlockedByMe) {
        throw new ForbiddenException('Unblock this contact to send a message');
      }
    }

    const type = payload.mediaUrl || payload.mediaType ? 'MEDIA' as const : 'CHAT' as const;

    // 1. Idempotency Check
    const clientMsgId = (payload as any).clientId || payload.tempId;
    if (clientMsgId) {
      const existing = await this.prisma.message.findFirst({
        where: {
          senderId,
          conversationId: realConvId,
          OR: [
            { payload: { path: ['tempId'], equals: clientMsgId } },
            { payload: { path: ['clientId'], equals: clientMsgId } }
          ]
        },
        include: {
          sender: { select: { id: true, username: true, displayName: true, avatar: true } },
          replyTo: { select: { id: true, senderId: true, payload: true, sender: { select: { displayName: true, username: true } } } }
        }
      });
      if (existing) {
        return this.formatMessageResponse(existing, realConvId, conversationId, senderId, clientMsgId);
      }
    }

    // 2. Transactional Write
    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          clientMessageId: clientMsgId || null,
          conversationId: realConvId,
          senderId,
          type,
          replyToId: payload.replyToId || null,
          payload: {
            text: payload.text || '',
            mediaUrl: payload.mediaUrl || null,
            mediaType: payload.mediaType || null,
            mentions: payload.mentions || [],
            inviteData: payload.inviteData || null,
            isForwarded: payload.isForwarded || false,
            forwardedFromMessageId: payload.forwardedFromMessageId || null,
            tempId: clientMsgId || null,
            clientId: clientMsgId || null,
          }
        },
        include: {
          sender: { select: { id: true, username: true, displayName: true, avatar: true } },
          replyTo: { select: { id: true, senderId: true, payload: true, sender: { select: { displayName: true, username: true } } } }
        }
      });

      await tx.conversation.update({
        where: { id: realConvId },
        data: {
          updatedAt: new Date(),
          lastMessageId: msg.id,
          lastMessageText: payload.text || (payload.mediaUrl ? (payload.mediaType === 'image' ? 'Photo' : payload.mediaType === 'video' ? 'Video' : 'Audio') : ''),
          lastMessageType: type,
          lastMessageAt: msg.createdAt,
          lastMessageSenderId: senderId,
        }
      });

      await tx.conversationParticipant.updateMany({
        where: { conversationId: realConvId, userId: { not: senderId } },
        data: { unreadCount: { increment: 1 } }
      });

      return msg;
    });

    return this.formatMessageResponse(message, realConvId, conversationId, senderId, clientMsgId);
  }

  private async formatMessageResponse(message: any, realConvId: string, publicIdOrId: string, senderId: string, clientMsgIdHint?: string) {
    const msgPayload = (message.payload as any) || {};
    let replyToObj: any = null;
    if (message.replyTo) {
      const rPayload = (message.replyTo.payload as any) || {};
      replyToObj = {
        id: message.replyTo.id,
        text: rPayload.text || '',
        senderName: message.replyTo.sender?.displayName || message.replyTo.sender?.username || '',
        from: message.replyTo.senderId === senderId ? 'me' : 'them'
      };
    }

    const convRecord = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: { publicId: true }
    });
    const pubId = convRecord?.publicId || publicIdOrId;
    const clientKey = msgPayload.clientId || msgPayload.tempId || clientMsgIdHint || null;

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
      type: message.type.toLowerCase(),
      payload: msgPayload,
      text: msgPayload.text || '',
      mediaUrl: msgPayload.mediaUrl || null,
      mediaType: msgPayload.mediaType || null,
      mentions: msgPayload.mentions || [],
      inviteData: msgPayload.inviteData || null,
      replyTo: replyToObj,
      status: 'sent',
      tempId: clientKey,
      clientId: clientKey,
    };
  }

  async getCatchupMessages(userId: string, sinceTimestamp: string) {
    if (!userId || !sinceTimestamp) return [];
    const sinceDate = new Date(sinceTimestamp);
    if (isNaN(sinceDate.getTime())) return [];

    const activeConvs = await this.prisma.conversationParticipant.findMany({
      where: { userId, deletedAt: null, leftAt: null },
      select: { conversationId: true }
    });
    if (activeConvs.length === 0) return [];

    const convIds = activeConvs.map(c => c.conversationId);
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: { in: convIds },
        createdAt: { gt: sinceDate },
        deletedAt: null,
        deletedByUsers: { none: { userId } }
      },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatar: true } },
        replyTo: { select: { id: true, senderId: true, payload: true, sender: { select: { displayName: true, username: true } } } }
      },
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    const formatted = await Promise.all(
      messages.map(m => this.formatMessageResponse(m, m.conversationId, m.conversationId, userId))
    );

    return formatted;
  }

  async getConversationHistory(conversationId: string, currentUserId?: string, deviceId?: string, beforeCursor?: string, limit: number = 50) {
    const realConvId = await this.resolveConversationId(conversationId, currentUserId);
    let clearedAt: Date | null = null;
    const whereCondition: any = {
      conversationId: realConvId,
      deletedAt: null
    };

    const [blocksMade, participants] = await Promise.all([
      currentUserId ? this.prisma.block.findMany({
        where: { blockerId: currentUserId },
        select: { blockedId: true }
      }) : Promise.resolve([]),
      this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, deletedAt: null },
        select: { userId: true, lastReadAt: true, clearedAt: true, leftAt: true, user: { select: { settings: { select: { readReceipts: true } } } } }
      })
    ]);

    const participant = participants.find(p => p.userId === currentUserId);
    if (participant) {
      clearedAt = participant.clearedAt;
      const pLeftAt = participant.leftAt;
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

    if (deviceId) {
      whereCondition.OR = [
        { targets: { some: { deviceId } } },
        { targets: { none: {} } }
      ];
    }
    
    // Pagination logic
    if (beforeCursor) {
      let cursorDate: Date | null = null;
      let cursorId: string | null = null;

      if (beforeCursor.startsWith('sys_created_')) {
        const actId = beforeCursor.replace(/^sys_created_/, '');
        const activity = await this.prisma.crewActivity.findUnique({ where: { id: actId }, select: { createdAt: true } });
        if (activity?.createdAt) cursorDate = activity.createdAt;
      } else if (beforeCursor.startsWith('sys_started_')) {
        const actId = beforeCursor.replace(/^sys_started_/, '');
        const activity = await this.prisma.crewActivity.findUnique({ where: { id: actId }, select: { startDate: true } });
        if (activity?.startDate) cursorDate = activity.startDate;
      } else {
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
          whereCondition.OR = [
            { createdAt: { lt: cursorDate } },
            { createdAt: cursorDate, id: { lt: cursorId } }
          ];
        } else {
          whereCondition.createdAt = {
            ...(typeof whereCondition.createdAt === 'object' ? whereCondition.createdAt : {}),
            lt: cursorDate
          };
        }
      }
    }

    const messages: any[] = await this.prisma.message.findMany({
      where: whereCondition,
      include: {
        targets: deviceId ? { where: { deviceId } } : false,
        sender: {
          select: { id: true, username: true, displayName: true, avatar: true }
        },
        replyTo: {
          select: {
            id: true,
            senderId: true,
            payload: true,
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop(); // Remove the extra item
    }
    messages.reverse(); // Return in chronological order
    const realDbMessages = messages.filter(m => !m.id.startsWith('sys_'));
    const oldestRealMessage = realDbMessages[0];
    const nextCursor = hasMore && oldestRealMessage ? oldestRealMessage.id : null;
    const otherParticipants = participants.filter(p => currentUserId && p.userId !== currentUserId);
    const otherReadTimestamps = otherParticipants
      .filter(p => p.user?.settings?.readReceipts !== false && p.lastReadAt != null)
      .map(p => new Date(p.lastReadAt!).getTime());

    const isAllRead = otherReadTimestamps.length > 0 && otherReadTimestamps.length === otherParticipants.length;
    const minOtherLastReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;

    const messagesMapped = messages.map(m => {
      const payload = (m.payload as any) || {};
      const target0 = m.targets && m.targets.length > 0 ? m.targets[0] : null;

      let replyToObj: any = null;
      if (m.replyTo) {
        const rPayload = (m.replyTo.payload as any) || {};
        replyToObj = {
          id: m.replyTo.id,
          text: rPayload.text || '',
          senderName: m.replyTo.sender?.displayName || m.replyTo.sender?.username || '',
          from: currentUserId && m.replyTo.senderId === currentUserId ? 'me' : 'them'
        };
      }

      const isRead = currentUserId && m.senderId === currentUserId && isAllRead && (minOtherLastReadAt + 5000 >= new Date(m.createdAt).getTime());
      const isUnsent = m.state === 'UNSENT';

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
        type: target0 ? target0.type : (m.type ? m.type.toLowerCase() : 'chat'),
        ciphertext: target0 ? target0.ciphertext : null,
        payload,
        text: isUnsent ? 'This message was unsent' : (payload.text || ''),
        mediaUrl: isUnsent ? null : (payload.mediaUrl || null),
        mediaType: isUnsent ? null : (payload.mediaType || null),
        mentions: isUnsent ? [] : (payload.mentions || []),
        inviteData: isUnsent ? null : (payload.inviteData || null),
        replyTo: replyToObj,
        status: isRead ? 'read' : 'sent',
        state: m.state || 'NORMAL'
      };
    });

    if (conversationId.startsWith('act_') || realConvId.startsWith('act_')) {
      const actId = (conversationId || realConvId).replace(/^act_/, '');
      const activity = await this.prisma.crewActivity.findUnique({
        where: { id: actId },
        select: { id: true, title: true, startDate: true, createdAt: true, creatorId: true }
      });

      if (activity) {
        const hasCreatedMsg = messagesMapped.some(m => String(m.text).includes('group chat created'));
        if (!hasCreatedMsg) {
          const createdSysMsg: any = {
            id: `sys_created_${activity.id}`,
            conversationId,
            senderId: activity.creatorId,
            senderName: 'System',
            senderAvatar: '',
            from: 'them',
            createdAt: activity.createdAt || new Date(),
            timestamp: activity.createdAt || new Date(),
            time: activity.createdAt ? new Date(activity.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
            type: 'system',
            ciphertext: null,
            payload: { text: 'Activity group chat created' },
            text: 'Activity group chat created',
            mediaUrl: null,
            mediaType: null,
            mentions: [],
            inviteData: null,
            replyTo: null,
            status: 'sent',
            state: 'NORMAL'
          };
          messagesMapped.unshift(createdSysMsg);
        }

        const hasStarted = messagesMapped.some(m => String(m.text).includes('has started'));
        if (!hasStarted && activity.startDate && new Date(activity.startDate) <= new Date()) {
          const startedSysMsg: any = {
            id: `sys_started_${activity.id}`,
            conversationId,
            senderId: 'system',
            senderName: 'System',
            senderAvatar: '',
            from: 'them',
            createdAt: activity.startDate,
            timestamp: activity.startDate,
            time: new Date(activity.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'system',
            ciphertext: null,
            payload: { text: 'Activity has started!' },
            text: 'Activity has started!',
            mediaUrl: null,
            mediaType: null,
            mentions: [],
            inviteData: null,
            replyTo: null,
            status: 'sent',
            state: 'NORMAL'
          };
          messagesMapped.push(startedSysMsg);
        }
      }
    }

    return {
      messages: messagesMapped,
      participants: participants.map(p => ({
        userId: p.userId,
        lastReadAt: p.user?.settings?.readReceipts !== false ? p.lastReadAt : null
      })),
      nextCursor
    };
  }

  private presenceCache = new Map<string, { data: any; expiresAt: number }>();
  async getUserConversations(userId: string, limit: number = 20, offset: number = 0) {
    const [participants, userBlocks] = await Promise.all([
      this.prisma.conversationParticipant.findMany({
        where: { userId, deletedAt: null },
        orderBy: { conversation: { updatedAt: 'desc' } },
        take: limit,
        skip: offset,
        select: {
          isMuted: true,
          isPinned: true,
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
              activityId: true,
              activity: true,
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
            }
          }
        }
      }),
      this.prisma.block.findMany({
        where: {
          OR: [
            { blockerId: userId },
            { blockedId: userId },
          ],
        },
        select: { blockerId: true, blockedId: true },
      })
    ]);

    const blockedByMeSet = new Set(userBlocks.filter(b => b.blockerId === userId).map(b => b.blockedId));
    const blockedByThemSet = new Set(userBlocks.filter(b => b.blockedId === userId).map(b => b.blockerId));

    const dmConvIds = participants.filter(p => p.conversation.type === 'DM').map(p => p.conversation.id);
    const dmOtherParticipants = dmConvIds.length > 0 ? await this.prisma.conversationParticipant.findMany({
      where: { conversationId: { in: dmConvIds }, userId: { not: userId }, leftAt: null, deletedAt: null },
      select: {
        conversationId: true,
        user: { select: { id: true, username: true, displayName: true, avatar: true } }
      }
    }) : [];

    const targetUserByConvId = new Map<string, any>();
    dmOtherParticipants.forEach(op => {
      if (op.user) targetUserByConvId.set(op.conversationId, op.user);
    });

    const targetUserIds = Array.from(targetUserByConvId.values()).map(u => u.id);
    const presenceMap = new Map<string, { isOnline: boolean; lastActive: string | null }>();
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
        const batchPresence = await this.presenceService.getPresenceMany(uncachedIds);
        batchPresence.forEach((presence, uId) => {
          const presData = {
            isOnline: presence?.status === 'online',
            lastActive: presence?.lastSeen || null
          };
          presenceMap.set(uId, presData);
          this.presenceCache.set(uId, { data: presData, expiresAt: now + 5000 });
        });
      }
    }

    return participants.map((p) => {
      const conv = p.conversation;
      const otherUser = targetUserByConvId.get(conv.id);
      const isGroupConv = conv.type === 'GROUP' || conv.type === 'ACTIVITY' || (conv as any).isGroup;
      const groupAvatar = conv.avatarKey || (conv as any).activity?.coverImage || (conv as any).activity?.image || null;
      const actStartDate = (conv as any).activity?.startDate;
      const actStatus = ((conv as any).activity?.status || conv.status || '').toUpperCase();
      const hasStarted = ['IN_PROGRESS', 'STARTED', 'COMPLETED', 'ENDED', 'CLOSED', 'CANCELLED'].includes(actStatus) || (!!actStartDate && new Date(actStartDate) <= new Date());

      const userPresence = otherUser ? presenceMap.get(otherUser.id) : null;
      let canSeeOnline = Boolean(otherUser && userPresence?.isOnline);
      let blockStatus = { isBlocked: false, isBlockedByMe: false, isBlockedByThem: false };

      if (otherUser) {
        const isBlockedByMe = blockedByMeSet.has(otherUser.id);
        const isBlockedByThem = blockedByThemSet.has(otherUser.id);
        blockStatus = { isBlocked: isBlockedByMe, isBlockedByMe, isBlockedByThem };
        if (isBlockedByThem) canSeeOnline = false;
      }

      const pubId = (conv as any).publicId || conv.id;
      const unreadCount = p.unreadCount || 0;

      const resolvedLastMsg = conv.lastMessageAt ? {
        id: conv.lastMessageId || null,
        createdAt: conv.lastMessageAt,
        senderId: conv.lastMessageSenderId || '',
        senderName: conv.lastMessageSenderId === userId ? 'You' : '',
        text: conv.lastMessageText || '',
        type: conv.lastMessageType ? conv.lastMessageType.toLowerCase() : 'chat',
        mediaUrl: null,
        mediaType: null,
      } : null;

      return {
        id: pubId,
        publicId: pubId,
        internalId: conv.id,
        type: conv.type,
        isMember: (p as any).leftAt == null,
        ownerId: conv.ownerId || null,
        activityId: conv.activityId || null,
        activity: conv.activity || null,
        hasStarted,
        activityHasStarted: hasStarted,
        isActivityChat: conv.type === 'ACTIVITY' || !!conv.activityId,
        isGroup: isGroupConv,
        name: isGroupConv ? (conv.name || (conv as any).activity?.title || 'Group') : (conv.name || otherUser?.displayName || 'Chat'),
        avatar: isGroupConv ? groupAvatar : (conv.avatarKey || otherUser?.avatar || null),
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
        memberCount: 0,
        pinned: p.isPinned || false,
        muted: p.isMuted || false,
        blocked: blockStatus.isBlockedByMe,
        isBlockedByMe: blockStatus.isBlockedByMe,
        isBlockedByThem: false,
        unreadCount,
        unread: unreadCount,
        lastMessage: resolvedLastMsg,
        targetUser: otherUser ? {
          id: otherUser.id,
          username: otherUser.username,
          displayName: otherUser.displayName,
          avatar: otherUser.avatar,
          isOnline: canSeeOnline ? (userPresence?.isOnline || false) : false,
          lastActive: userPresence?.lastActive || null
        } : null
      };
    });
  }

  async isUserBlockedBy(userId: string, targetUserId: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: { blockerId: targetUserId, blockedId: userId }
    });
    return !!block;
  }

  async startConversation(userIds: string[], currentUserId: string, groupName?: string) {
    const filteredUserIds = (userIds || []).filter(id => id && id !== currentUserId);

    if (filteredUserIds.length === 0) {
      throw new ForbiddenException('Cannot start a conversation with yourself');
    }

    const isBlocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: { in: filteredUserIds } },
          { blockerId: { in: filteredUserIds }, blockedId: currentUserId }
        ]
      }
    });
    if (isBlocked) {
      throw new ForbiddenException('Cannot start a conversation with a blocked user');
    }

    if (filteredUserIds.length === 1 && !groupName) {
      const otherUserId = filteredUserIds[0];
      const existing = await this.prisma.conversation.findFirst({
        where: {
          type: 'DM',
          AND: [
            { participants: { some: { userId: currentUserId } } },
            { participants: { some: { userId: otherUserId } } }
          ]
        }
      });
      if (existing) {
        const pubId = (existing as any).publicId || existing.id;
        return { id: pubId, publicId: pubId };
      }
    }

    const participants = [...new Set([...filteredUserIds, currentUserId])].map(id => ({
      userId: id,
      role: id === currentUserId ? 'OWNER' as const : 'MEMBER' as const
    }));

    const newPubId = generatePublicId();
    const conv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        name: groupName || null,
        type: participants.length > 2 || groupName ? 'GROUP' : 'DM',
        ownerId: participants.length > 2 || groupName ? currentUserId : null,
        participants: {
          create: participants
        }
      }
    });
    return { id: newPubId, publicId: newPubId };
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

  async markAsRead(conversationId: string, userId: string): Promise<{ success: boolean }> {
    // Acknowledge immediately — DB work runs in setImmediate (write-behind).
    // WhatsApp/Slack pattern: never block the response on a read-receipt write.
    setImmediate(() => void this._persistMarkAsRead(conversationId, userId));
    return { success: true };
  }

  private async _persistMarkAsRead(conversationId: string, userId: string): Promise<void> {
    try {
      // resolveConversationId is now cached (30s TTL), so this is near-free after first call
      const realConvId = await this.resolveConversationId(conversationId, userId);

      // Merge existence check: findFirst returns null without throwing if row doesn't exist
      const conv = await this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { id: true }
      });
      if (!conv) return;

      const now = new Date();

      // Upsert lastReadAt — now runs after response already returned, no lock contention visible to client
      await this.prisma.conversationParticipant.upsert({
        where: { userId_conversationId: { userId, conversationId: realConvId } },
        update: { lastReadAt: now, unreadCount: 0 },
        create: { userId, conversationId: realConvId, lastReadAt: now, unreadCount: 0 }
      }).catch(() => {});

      // Notify other participants of the read state (socket only, no extra DB read needed for basic ack)
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
      this.logger.warn(`markAsRead background write failed: ${(err as Error)?.message}`);
    }
  }

  async isUserConversationMuted(conversationId: string, userId: string): Promise<boolean> {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      select: { isMuted: true }
    });
    return participant?.isMuted || false;
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

  async deleteConversationForUser(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId: realConvId } },
      data: { deletedAt: new Date() }
    });
    return { success: true };
  }

  async unsendMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true, createdAt: true, state: true }
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
        deletedAt: new Date()
      }
    });

    return {
      success: true,
      id: message.id,
      messageId: message.id,
      conversationId: message.conversationId,
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

  async updateGroupInfo(conversationId: string, userId: string, data: { name?: string; description?: string; avatarKey?: string; avatar?: string }) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: { editGroupPermission: true }
    });

    const perm = (conversation?.editGroupPermission || '').toUpperCase();
    const isAllowed = participant.role === 'OWNER' || participant.role === 'ADMIN' || perm === 'EVERYONE' || perm === 'ALL_MEMBERS' || perm === 'ALL';
    if (!isAllowed) {
      throw new ForbiddenException('Only group admins can edit group details');
    }

    let avatarVal = data.avatarKey !== undefined ? data.avatarKey : data.avatar;
    if (avatarVal && typeof avatarVal === 'string' && avatarVal.startsWith('blob:')) {
      avatarVal = undefined;
    }

    const updated = await this.prisma.conversation.update({
      where: { id: realConvId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(avatarVal !== undefined ? { avatarKey: avatarVal } : {}),
      }
    });

    if (updated.activityId && avatarVal !== undefined) {
      await this.prisma.crewActivity.update({
        where: { id: updated.activityId },
        data: { coverImage: avatarVal }
      }).catch(() => {});
    }

    return updated;
  }

  async addGroupMember(conversationId: string, requesterId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: requesterId, conversationId: realConvId } }
    });
    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    const convRecord = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: { activityId: true }
    });

    if (convRecord?.activityId) {
      const activity = await this.prisma.crewActivity.findUnique({
        where: { id: convRecord.activityId },
        select: { startDate: true, status: true }
      });
      if (activity) {
        const startRaw = activity.startDate;
        const status = activity.status as string;
        const hasStarted = (status === 'STARTED' || status === 'IN_PROGRESS' || status === 'ENDED') || (startRaw && new Date(startRaw) <= new Date());
        if (!hasStarted) {
          throw new BadRequestException('Members cannot be added directly to an activity group chat before the activity starts. Join or invite via the activity.');
        }
      }
    }

    await this.prisma.conversationParticipant.upsert({
      where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } },
      update: {
        leftAt: null,
        deletedAt: null,
        joinedAt: new Date(),
        role: 'MEMBER'
      } as any,
      create: { userId: targetUserId, conversationId: realConvId, role: 'MEMBER' }
    });

    return { success: true };
  }

  async removeGroupMember(conversationId: string, requesterId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const requester = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: requesterId, conversationId: realConvId } }
    });
    if (!requester || (requester.role !== 'OWNER' && requester.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can remove members');
    }

    const target = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } }
    });

    if (!target || (target as any).leftAt || target.deletedAt) {
      throw new NotFoundException('Member not found in group');
    }

    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the group owner');
    }

    if (requester.role === 'ADMIN' && target.role === 'ADMIN') {
      throw new ForbiddenException('Admins cannot remove other admins. Only the owner can remove admins.');
    }

    const convRecord = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: { activityId: true }
    });

    if (convRecord?.activityId) {
      const activity = await this.prisma.crewActivity.findUnique({
        where: { id: convRecord.activityId },
        select: { startDate: true, status: true }
      });
      if (activity) {
        const startRaw = activity.startDate;
        const status = activity.status as string;
        const hasStarted = (status === 'STARTED' || status === 'IN_PROGRESS' || status === 'ENDED') || (startRaw && new Date(startRaw) <= new Date());
        if (!hasStarted) {
          await this.prisma.crewActivityMember.deleteMany({
            where: { activityId: convRecord.activityId, userId: targetUserId }
          }).catch(() => {});
        }
      }
    }

    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } },
      data: { leftAt: new Date() } as any
    });

    return { success: true };
  }

  async leaveGroup(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });

    if (!participant || (participant as any).leftAt || participant.deletedAt) {
      return { success: true };
    }

    const convRecord = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: { activityId: true }
    });

    let isPreStartActivity = false;
    if (convRecord?.activityId) {
      const activity = await this.prisma.crewActivity.findUnique({
        where: { id: convRecord.activityId },
        select: { startDate: true, status: true }
      });
      if (activity) {
        const startRaw = activity.startDate;
        const status = activity.status as string;
        const hasStarted = (status === 'STARTED' || status === 'IN_PROGRESS' || status === 'ENDED') || (startRaw && new Date(startRaw) <= new Date());
        if (!hasStarted) {
          isPreStartActivity = true;
          await this.prisma.crewActivityMember.deleteMany({
            where: { activityId: convRecord.activityId, userId }
          }).catch(() => {});
        }
      }
    }

    if (isPreStartActivity) {
      await this.prisma.conversationParticipant.deleteMany({
        where: { conversationId: realConvId, userId }
      });
    } else {
      await this.prisma.conversationParticipant.update({
        where: { userId_conversationId: { userId, conversationId: realConvId } },
        data: { leftAt: new Date() } as any
      });
    }

    if (participant.role === 'OWNER') {
      // Transfer to oldest admin first
      const oldestAdmin = await this.prisma.conversationParticipant.findFirst({
        where: { conversationId: realConvId, deletedAt: null, role: 'ADMIN' },
        orderBy: { joinedAt: 'asc' }
      });

      if (oldestAdmin) {
        await this.prisma.$transaction([
          this.prisma.conversationParticipant.update({
            where: { userId_conversationId: { userId: oldestAdmin.userId, conversationId: realConvId } },
            data: { role: 'OWNER' }
          }),
          this.prisma.conversation.update({
            where: { id: realConvId },
            data: { ownerId: oldestAdmin.userId }
          })
        ]);
      } else {
        const oldestMember = await this.prisma.conversationParticipant.findFirst({
          where: { conversationId: realConvId, deletedAt: null },
          orderBy: { joinedAt: 'asc' }
        });

        if (oldestMember) {
          await this.prisma.$transaction([
            this.prisma.conversationParticipant.update({
              where: { userId_conversationId: { userId: oldestMember.userId, conversationId: realConvId } },
              data: { role: 'OWNER' }
            }),
            this.prisma.conversation.update({
              where: { id: realConvId },
              data: { ownerId: oldestMember.userId }
            })
          ]);
        } else {
          await this.prisma.conversation.update({
            where: { id: realConvId },
            data: { status: 'Closed' }
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
  ): Promise<{ id: string }> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DM',
        isInstantMatch: true,
        AND: [
          { participants: { some: { userId: userAId } } },
          { participants: { some: { userId: userBId } } },
        ],
      },
    });

    if (existing) {
      const pubId = (existing as any).publicId || existing.id;
      return { id: pubId };
    }

    const newPubId = generatePublicId();
    const conv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        type: 'DM',
        isInstantMatch: true,
        expiresAt,
        participants: {
          create: [{ userId: userAId }, { userId: userBId }],
        },
      },
    });

    const activityLabel = activity.charAt(0).toUpperCase() + activity.slice(1);
    await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: userAId,
        type: 'SYSTEM',
        payload: {
          text: `⚡ Instant Match — ${activityLabel}! You've been connected. Say hi!`,
        },
      },
    });

    return { id: newPubId };
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

  async updateGroupSettings(conversationId: string, userId: string, data: any) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    
    if (data.groupUpdatesActive !== undefined && participant) {
      await this.prisma.conversationParticipant.update({
        where: { userId_conversationId: { userId, conversationId: realConvId } },
        data: { groupUpdatesActive: data.groupUpdatesActive }
      });
      delete data.groupUpdatesActive;
    }
    
    if (Object.keys(data).length > 0) {
      if (!participant || (participant.role !== 'OWNER' && participant.role !== 'ADMIN')) {
        throw new ForbiddenException('Only group admins can update these settings');
      }
      await this.prisma.conversation.update({
        where: { id: realConvId },
        data
      });
    }
    return { success: true };
  }

  async updateGroupEditPermission(conversationId: string, userId: string, permission: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || (participant.role !== 'OWNER' && participant.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can update settings');
    }
    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { editGroupPermission: permission }
    });
    return { success: true };
  }

  async changeGroupOwner(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can transfer ownership');
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
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can promote admins');
    }
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } },
      data: { role: 'ADMIN' }
    });
    return { success: true };
  }

  async demoteFromAdmin(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can demote admins');
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

  async acceptGroupJoinRequest(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || (participant.role !== 'OWNER' && participant.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can accept requests');
    }
    
    await this.prisma.$transaction([
      this.prisma.conversationJoinRequest.delete({
        where: { conversationId_userId: { conversationId: realConvId, userId: targetUserId } }
      }),
      this.prisma.conversationParticipant.upsert({
        where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } },
        update: {
          leftAt: null,
          deletedAt: null,
          joinedAt: new Date(),
          role: 'MEMBER'
        } as any,
        create: { userId: targetUserId, conversationId: realConvId, role: 'MEMBER' }
      })
    ]);
    return { success: true };
  }

  async declineGroupJoinRequest(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || (participant.role !== 'OWNER' && participant.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can decline requests');
    }
    
    await this.prisma.conversationJoinRequest.delete({
      where: { conversationId_userId: { conversationId: realConvId, userId: targetUserId } }
    }).catch(() => {});
    
    return { success: true };
  }

  async requestGroupJoin(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const conversation: any = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      include: {
        participants: { where: { userId, leftAt: null, deletedAt: null } as any }
      }
    });

    if (!conversation) throw new NotFoundException('Group not found');
    if (conversation.participants.length > 0) return { status: 'JOINED' };

    const whoCanJoin = conversation.whoCanJoin || 'ANYONE';
    if (whoCanJoin === 'ANYONE') {
      await this.prisma.conversationParticipant.upsert({
        where: { userId_conversationId: { userId, conversationId: realConvId } },
        create: { userId, conversationId: realConvId, role: 'MEMBER' },
        update: {
          leftAt: null,
          deletedAt: null,
          joinedAt: new Date(),
          role: 'MEMBER'
        } as any
      });
      return { status: 'JOINED' };
    }

    await this.prisma.conversationJoinRequest.upsert({
      where: { conversationId_userId: { conversationId: realConvId, userId } },
      create: { conversationId: realConvId, userId, status: 'PENDING' },
      update: { status: 'PENDING' }
    });

    return { status: 'PENDING' };
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

  async getConversationById(conversationId: string) {
    const realId = await this.resolveConversationId(conversationId);
    return this.prisma.conversation.findUnique({
      where: { id: realId },
      include: {
        avatarMedia: true,
      }
    });
  }
}
