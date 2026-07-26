import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from '../../presence/presence.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';

@Injectable()
export class MessagingCoreService {
  constructor(
    protected prisma: PrismaService,
    protected presenceService: PresenceService,
    @Inject(forwardRef(() => RealtimeGateway))
    protected realtimeGateway: RealtimeGateway,
  ) {}

  async resolveConversationId(identifier: string, currentUserId?: string): Promise<string> {
    if (!identifier) return identifier;
    const cleanId = String(identifier).replace(/^(act_)+/, '');
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
        return conv.id;
      }

      if (currentUserId && identifier !== currentUserId) {
        const dm = await this.prisma.conversation.findFirst({
          where: {
            type: 'DIRECT' as any,
            AND: [
              { participants: { some: { userId: currentUserId } } },
              { participants: { some: { userId: identifier } } }
            ]
          },
          select: { id: true }
        });
        if (dm?.id) {
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
    payload: SendMessageDto
  ): Promise<MessageResponseDto> {
    const realConvId = await this.resolveConversationId(conversationId, senderId);

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: senderId, conversationId: realConvId } }
    });
    if (!participant || (participant as any).leftAt || participant.deletedAt) {
      throw new ForbiddenException('You are no longer a member of this conversation');
    }

    const otherParticipants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, userId: { not: senderId }, deletedAt: null },
      select: { userId: true }
    });

    if (otherParticipants.length > 0) {
      const otherUserIds = otherParticipants.map(p => p.userId);
      const isBlockedByMe = await this.prisma.block.findFirst({
        where: { blockerId: senderId, blockedId: { in: otherUserIds } }
      });
      if (isBlockedByMe) {
        throw new ForbiddenException('Unblock this contact to send a message');
      }
    }

    const type = payload.mediaUrl || payload.mediaType ? ('MEDIA' as const) : ('CHAT' as const);

    const message: any = await this.prisma.message.create({
      data: {
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
        }
      },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatar: true }
        },
        replyTo: {
          select: {
            id: true,
            senderId: true,
            payload: true,
            sender: { select: { displayName: true, username: true } }
          }
        }
      }
    });

    await this.prisma.conversation.update({
      where: { id: realConvId },
      data: { updatedAt: new Date() }
    });

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
    const pubId = convRecord?.publicId || conversationId;

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
      status: 'sent'
    };
  }

  async getConversationHistory(
    conversationId: string,
    currentUserId?: string,
    deviceId?: string,
    beforeCursor?: string,
    limit: number = 50
  ) {
    const realConvId = await this.resolveConversationId(conversationId, currentUserId);
    let clearedAt: Date | null = null;
    const whereCondition: any = {
      conversationId: realConvId,
      deletedAt: null
    };

    if (currentUserId) {
      whereCondition.deletedByUsers = {
        none: { userId: currentUserId }
      };
    }

    const [participant, blocksMade, participants] = await Promise.all([
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

    if (deviceId) {
      whereCondition.OR = [
        { targets: { some: { deviceId } } },
        { targets: { none: {} } }
      ];
    }

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
        targets: deviceId ? { where: { deviceId } } : true,
        sender: {
          select: { id: true, username: true, displayName: true, avatar: true }
        },
        replyTo: {
          select: {
            id: true,
            senderId: true,
            payload: true,
            sender: { select: { displayName: true, username: true } }
          }
        }
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

      const isRead = currentUserId && m.senderId === currentUserId && isAllRead && minOtherLastReadAt >= new Date(m.createdAt).getTime();
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

  async markAsRead(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const now = new Date();
    await this.prisma.conversationParticipant.upsert({
      where: {
        userId_conversationId: {
          userId,
          conversationId: realConvId
        }
      },
      update: {
        lastReadAt: now
      },
      create: {
        userId,
        conversationId: realConvId,
        lastReadAt: now
      }
    }).catch(() => { });

    const userSettings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { readReceipts: true }
    });

    if (userSettings?.readReceipts !== false && this.realtimeGateway?.server) {
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, deletedAt: null },
        select: { userId: true, lastReadAt: true, user: { select: { settings: { select: { readReceipts: true } } } } }
      });

      for (const p of participants) {
        if (p.userId !== userId) {
          const otherParticipants = participants.filter(item => item.userId !== p.userId);
          const otherReadTimestamps = otherParticipants
            .filter(item => item.user?.settings?.readReceipts !== false && item.lastReadAt != null)
            .map(item => new Date(item.lastReadAt!).getTime());

          const isAllRead = otherReadTimestamps.length > 0 && otherReadTimestamps.length === otherParticipants.length;
          const minOtherReadAt = isAllRead ? Math.min(...otherReadTimestamps) : 0;

          this.realtimeGateway.server.to(p.userId).emit('conversation:seen', {
            conversationId,
            readerId: userId,
            lastReadAt: now.toISOString(),
            isAllRead,
            minOtherReadAt: minOtherReadAt ? new Date(minOtherReadAt).toISOString() : null
          });
        }
      }
    }

    return { success: true };
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
