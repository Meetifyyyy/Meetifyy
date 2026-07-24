import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { checkPresenceVisibility } from '../users/privacy.helper';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private presenceService: PresenceService,
  ) { }

  async saveEncryptedMessage(senderId: string, senderDeviceId: string, conversationId: string, targets: any[]) {
    // 1. Ensure conversation exists
    let conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    // 2. Save the message
    const message = await this.prisma.message.create({
      data: {
        conversationId,
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
    }
  ) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: senderId, conversationId } }
    });
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    const otherParticipants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: senderId }, deletedAt: null },
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

    const type = payload.mediaUrl || payload.mediaType ? 'MEDIA' as const : 'CHAT' as const;

    const message: any = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        type,
        replyToId: payload.replyToId || null,
        payload: {
          text: payload.text || '',
          mediaUrl: payload.mediaUrl || null,
          mediaType: payload.mediaType || null,
          mentions: payload.mentions || [],
          inviteData: payload.inviteData || null,
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
      where: { id: conversationId },
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

    return {
      id: message.id,
      conversationId: message.conversationId,
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

  async getConversationHistory(conversationId: string, currentUserId?: string, deviceId?: string) {
    let clearedAt: Date | null = null;
    const whereCondition: any = {
      conversationId,
      deletedAt: null
    };

    if (currentUserId) {
      const participant = await this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId: currentUserId, conversationId } }
      });
      if (participant) {
        clearedAt = participant.clearedAt;
      }

      const blocksMade = await this.prisma.block.findMany({
        where: { blockerId: currentUserId },
        select: { blockedId: true }
      });
      if (blocksMade.length > 0) {
        whereCondition.NOT = {
          senderId: { in: blocksMade.map(b => b.blockedId) }
        };
      }
    }

    if (clearedAt) {
      whereCondition.createdAt = { gt: clearedAt };
    }

    if (deviceId) {
      whereCondition.OR = [
        { targets: { some: { deviceId } } },
        { targets: { none: {} } }
      ];
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
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, deletedAt: null },
      select: { userId: true, lastReadAt: true, user: { select: { settings: { select: { readReceipts: true } } } } }
    });

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
        type: target0 ? target0.type : m.type.toLowerCase(),
        ciphertext: target0 ? target0.ciphertext : null,
        payload,
        text: payload.text || '',
        mediaUrl: payload.mediaUrl || null,
        mediaType: payload.mediaType || null,
        mentions: payload.mentions || [],
        inviteData: payload.inviteData || null,
        replyTo: replyToObj,
        status: 'sent'
      };
    });

    return {
      messages: messagesMapped,
      participants: participants.map(p => ({
        userId: p.userId,
        lastReadAt: p.user?.settings?.readReceipts !== false ? p.lastReadAt : null
      }))
    };
  }

  async getUserConversations(userId: string, limit: number = 20, offset: number = 0) {
    // 1. Hard cleanup expired instant matches
    const now = new Date();
    await this.prisma.conversation.deleteMany({
      where: {
        isInstantMatch: true,
        expiresAt: { lt: now }
      }
    }).catch(() => { });

    // 2. Fetch user's active participants
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { userId, deletedAt: null },
      take: limit,
      skip: offset,
      select: {
        isMuted: true,
        isPinned: true,
        clearedAt: true,
        lastReadAt: true,
        conversation: {
          select: {
            id: true,
            name: true,
            avatarKey: true,
            description: true,
            type: true,
            ownerId: true,
            status: true,
            isInstantMatch: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
            participants: {
              where: { userId: { not: userId }, deletedAt: null },
              take: 5,
              select: {
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
                        showLastSeen: true,
                        whoCanSeeLastSeen: true,
                        readReceipts: true
                      }
                    }
                  }
                }
              }
            },
          }
        }
      }
    });

    const convIds = participants.map(p => p.conversation.id);

    // Fetch last messages & unread counts
    const lastMessages = convIds.length > 0
      ? await this.prisma.message.findMany({
        where: { conversationId: { in: convIds }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        distinct: ['conversationId'],
        select: { conversationId: true, createdAt: true, senderId: true, payload: true }
      })
      : [];

    const lastMsgMap = new Map(lastMessages.map(m => [
      m.conversationId,
      {
        createdAt: m.createdAt,
        senderId: m.senderId,
        text: (m.payload as any)?.text || ''
      }
    ]));

    // Compute unread counts per conversation
    const unreadMap = new Map<string, number>();
    await Promise.all(convIds.map(async (cId) => {
      const part = participants.find(p => p.conversation.id === cId);
      if (!part) return;

      const filterDate = part.lastReadAt || part.clearedAt || new Date(0);
      const count = await this.prisma.message.count({
        where: {
          conversationId: cId,
          senderId: { not: userId },
          deletedAt: null,
          createdAt: { gt: filterDate }
        }
      });
      unreadMap.set(cId, count);
    }));

    const userIdsToFetchPresence = participants
      .map(p => p.conversation.participants[0]?.user)
      .filter((u): u is any => !!u && u.settings?.showOnlineStatus !== false)
      .map(u => u.id);

    const presenceMap = new Map<string, { isOnline: boolean; lastActive: string | null }>();
    await Promise.all(
      userIdsToFetchPresence.map(async (uId) => {
        const presence = await this.presenceService.getPresence(uId);
        presenceMap.set(uId, {
          isOnline: presence?.status === 'online',
          lastActive: presence?.lastSeen || null
        });
      })
    );

    // Pre-fetch block relationships for all conversations in a single batch query
    const userBlocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: userId },
          { blockedId: userId },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blockedByMeSet = new Set(userBlocks.filter(b => b.blockerId === userId).map(b => b.blockedId));
    const blockedByThemSet = new Set(userBlocks.filter(b => b.blockedId === userId).map(b => b.blockerId));

    return Promise.all(participants.map(async (p) => {
      const conv = p.conversation;
      const otherUser = conv.participants[0]?.user;
      const lastMsgInfo = lastMsgMap.get(conv.id);
      const userPresence = otherUser ? presenceMap.get(otherUser.id) : null;
      const unreadCount = unreadMap.get(conv.id) || 0;

      let canSeeOnline = false;
      let canSeeLastSeen = false;

      let blockStatus = { isBlocked: false, isBlockedByMe: false, isBlockedByThem: false };

      if (otherUser) {
        canSeeOnline = Boolean(userPresence?.isOnline && otherUser.settings?.showOnlineStatus !== false);
        canSeeLastSeen = !!userPresence?.lastActive && otherUser.settings?.showLastSeen !== false;

        const isBlockedByMe = blockedByMeSet.has(otherUser.id);
        const isBlockedByThem = blockedByThemSet.has(otherUser.id);
        blockStatus = {
          isBlocked: isBlockedByMe,
          isBlockedByMe,
          isBlockedByThem,
        };
        if (isBlockedByThem) {
          canSeeOnline = false;
          canSeeLastSeen = false;
        }
      }

      return {
        id: conv.id,
        type: conv.type,
        ownerId: conv.ownerId || null,
        name: conv.name || otherUser?.displayName || 'Group',
        avatar: conv.avatarKey || otherUser?.avatar,
        description: conv.description || null,
        status: conv.status || 'ACTIVE',
        isInstantMatch: conv.isInstantMatch || false,
        expiresAt: conv.expiresAt || null,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        pinned: p.isPinned || false,
        muted: p.isMuted || false,
        blocked: blockStatus.isBlockedByMe,
        isBlockedByMe: blockStatus.isBlockedByMe,
        isBlockedByThem: false, // Hide block status from recipient for Instagram-style privacy
        unreadCount,
        unread: unreadCount,
        lastMessage: lastMsgInfo ? { createdAt: lastMsgInfo.createdAt, senderId: lastMsgInfo.senderId, text: lastMsgInfo.text } : null,
        targetUser: otherUser ? {
          id: otherUser.id,
          username: otherUser.username,
          displayName: otherUser.displayName,
          avatar: otherUser.avatar,
          isOnline: canSeeOnline ? (userPresence?.isOnline || false) : false,
          lastActive: canSeeLastSeen ? (userPresence?.lastActive || null) : null
        } : null
      };
    }));
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
            { participants: { some: { userId: currentUserId, deletedAt: null } } },
            { participants: { some: { userId: otherUserId, deletedAt: null } } }
          ]
        }
      });
      if (existing) return { id: existing.id };
    }

    const participants = [...new Set([...filteredUserIds, currentUserId])].map(id => ({
      userId: id,
      role: id === currentUserId ? 'OWNER' as const : 'MEMBER' as const
    }));

    const conv = await this.prisma.conversation.create({
      data: {
        name: groupName || null,
        type: participants.length > 2 || groupName ? 'GROUP' : 'DM',
        ownerId: participants.length > 2 || groupName ? currentUserId : null,
        participants: {
          create: participants
        }
      }
    });
    return { id: conv.id };
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

  async markAsRead(conversationId: string, userId: string) {
    await this.prisma.conversationParticipant.update({
      where: {
        userId_conversationId: {
          userId,
          conversationId
        }
      },
      data: {
        lastReadAt: new Date()
      }
    }).catch(() => { });
    return { success: true };
  }

  async muteConversation(conversationId: string, userId: string, muted: boolean) {
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { isMuted: muted }
    });
    return { success: true, muted };
  }

  async pinConversation(conversationId: string, userId: string, pinned: boolean) {
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { isPinned: pinned }
    });
    return { success: true, pinned };
  }

  async clearChatForUser(conversationId: string, userId: string) {
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { clearedAt: new Date() }
    });
    return { success: true };
  }

  async deleteConversationForUser(conversationId: string, userId: string) {
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { deletedAt: new Date() }
    });
    return { success: true };
  }

  async updateGroupInfo(conversationId: string, userId: string, data: { name?: string; description?: string; avatarKey?: string }) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId } }
    });
    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.avatarKey !== undefined ? { avatarKey: data.avatarKey } : {}),
      }
    });

    return updated;
  }

  async addGroupMember(conversationId: string, requesterId: string, targetUserId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: requesterId, conversationId } }
    });
    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    await this.prisma.conversationParticipant.upsert({
      where: { userId_conversationId: { userId: targetUserId, conversationId } },
      update: { deletedAt: null },
      create: { userId: targetUserId, conversationId, role: 'MEMBER' }
    });

    return { success: true };
  }

  async removeGroupMember(conversationId: string, requesterId: string, targetUserId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId: requesterId, conversationId } }
    });
    if (!participant || (participant.role !== 'OWNER' && participant.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can remove members');
    }

    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId: targetUserId, conversationId } },
      data: { deletedAt: new Date() }
    });

    return { success: true };
  }

  async leaveGroup(conversationId: string, userId: string) {
    await this.prisma.conversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { deletedAt: new Date() }
    });
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
      return { id: existing.id };
    }

    const conv = await this.prisma.conversation.create({
      data: {
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

    return { id: conv.id };
  }

  async unsendMessage(messageId: string, requestingUserId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, conversationId: true, deletedAt: true },
    });

    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== requestingUserId) {
      throw new ForbiddenException('You can only unsend your own messages');
    }
    if (message.deletedAt) {
      return { success: true, alreadyDeleted: true, conversationId: message.conversationId };
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    return { success: true, messageId, conversationId: message.conversationId };
  }

  async getConversationParticipantIds(conversationId: string): Promise<string[]> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, deletedAt: null },
      select: { userId: true },
    });
    return participants.map(p => p.userId);
  }
}
