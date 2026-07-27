import { Injectable, ForbiddenException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { MessagingCoreService } from '../core/messaging-core.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { generatePublicId } from '../../common/utils/public-id.util';

@Injectable()
export class DmService extends MessagingCoreService {
  constructor(
    prisma: PrismaService,
    presenceService: PresenceService,
    domainEventService: DomainEventService,
  ) {
    super(prisma, presenceService, domainEventService);
  }

  async getUserDMConversations(userId: string, limit: number = 20, offset: number = 0) {
    const now = new Date();
    this.prisma.conversation.deleteMany({
      where: {
        isInstantMatch: true,
        expiresAt: { lt: now }
      }
    }).catch(() => { });

    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        conversation: { type: 'DM' }
      },
      take: limit,
      skip: offset,
      select: {
        isMuted: true,
        isPinned: true,
        clearedAt: true,
        lastReadAt: true,
        groupUpdatesActive: true,
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
            isInstantMatch: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
            participants: {
              where: { leftAt: null, deletedAt: null } as any,
              select: {
                userId: true,
                role: true,
                joinedAt: true,
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

    const lastMessages = await Promise.all(
      participants.map(async (part) => {
        const cId = part.conversation.id;
        const clearedAt = part.clearedAt;
        const whereClause: any = {
          conversationId: cId,
          deletedAt: null
        };
        if (clearedAt) {
          whereClause.createdAt = { gt: clearedAt };
        }
        const lastMsg = await this.prisma.message.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          select: { id: true, conversationId: true, createdAt: true, senderId: true, type: true, payload: true, sender: { select: { id: true, displayName: true, username: true } } }
        });
        return { cId, lastMsg };
      })
    );

    const lastMsgMap = new Map(
      lastMessages.map(({ cId, lastMsg }) => {
        if (!lastMsg) return [cId, null];
        const payload = (lastMsg.payload as any) || {};
        let text = payload.text || '';
        if (!text) {
          const mType = (payload.mediaType || lastMsg.type || '').toLowerCase();
          if (mType.includes('image') || mType.includes('photo')) text = 'Photo';
          else if (mType.includes('video')) text = 'Video';
          else if (mType.includes('audio') || mType.includes('voice')) text = 'Audio';
          else if (payload.mediaUrl) text = 'Attachment';
        }
        return [
          cId,
          {
            createdAt: lastMsg.createdAt,
            senderId: lastMsg.senderId,
            senderName: lastMsg.sender?.displayName || lastMsg.sender?.username || 'Member',
            type: lastMsg.type ? lastMsg.type.toLowerCase() : 'chat',
            text,
            mediaUrl: payload.mediaUrl || null,
            mediaType: payload.mediaType || null
          }
        ];
      })
    );

    const unreadMap = new Map<string, number>();
    if (convIds.length > 0) {
      await Promise.all(participants.map(async (part) => {
        const cId = part.conversation.id;
        const readAt = part.lastReadAt ? new Date(part.lastReadAt).getTime() : 0;
        const clearAt = part.clearedAt ? new Date(part.clearedAt).getTime() : 0;
        const maxTime = Math.max(readAt, clearAt);
        const filterDate = maxTime > 0 ? new Date(maxTime) : new Date(0);

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
    }

    const userIdsToFetchPresence = participants
      .map(p => {
        const otherP = p.conversation.participants.find(pt => pt.userId !== userId);
        return otherP?.user;
      })
      .filter((u): u is any => !!u && u.settings?.showOnlineStatus !== false)
      .map(u => u.id);

    const presenceMap = new Map<string, { isOnline: boolean; lastActive: string | null }>();
    if (userIdsToFetchPresence.length > 0) {
      const batchPresence = await this.presenceService.getPresenceMany(userIdsToFetchPresence);
      batchPresence.forEach((presence, uId) => {
        presenceMap.set(uId, {
          isOnline: presence?.status === 'online',
          lastActive: presence?.lastSeen || null
        });
      });
    }

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
      const allParticipants = conv.participants || [];
      const otherParticipantObj = allParticipants.find(part => part.userId !== userId);
      const otherUser = otherParticipantObj?.user;

      const lastMsgInfo = lastMsgMap.get(conv.id);
      const userPresence = otherUser ? presenceMap.get(otherUser.id) : null;
      const unreadCount = unreadMap.get(conv.id) || 0;

      let canSeeOnline = false;
      let blockStatus = { isBlocked: false, isBlockedByMe: false, isBlockedByThem: false };

      if (otherUser) {
        canSeeOnline = Boolean(userPresence?.isOnline && otherUser.settings?.showOnlineStatus !== false);
        const isBlockedByMe = blockedByMeSet.has(otherUser.id);
        const isBlockedByThem = blockedByThemSet.has(otherUser.id);
        blockStatus = {
          isBlocked: isBlockedByMe,
          isBlockedByMe,
          isBlockedByThem,
        };
        if (isBlockedByThem) {
          canSeeOnline = false;
        }
      }

      const pubId = (conv as any).publicId || conv.id;
      return {
        id: pubId,
        publicId: pubId,
        internalId: conv.id,
        type: 'DM' as const,
        isMember: (p as any).leftAt == null,
        ownerId: conv.ownerId || null,
        name: conv.name || otherUser?.displayName || 'Chat',
        avatar: conv.avatarKey || otherUser?.avatar || null,
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
        isBlockedByThem: false,
        unreadCount,
        unread: unreadCount,
        lastMessage: lastMsgInfo ? {
          createdAt: lastMsgInfo.createdAt,
          senderId: lastMsgInfo.senderId,
          senderName: lastMsgInfo.senderName,
          text: lastMsgInfo.text,
          type: lastMsgInfo.type,
          mediaUrl: lastMsgInfo.mediaUrl,
          mediaType: lastMsgInfo.mediaType
        } : null,
        targetUser: otherUser ? {
          id: otherUser.id,
          username: otherUser.username,
          displayName: otherUser.displayName,
          avatar: otherUser.avatar,
          isOnline: canSeeOnline ? (userPresence?.isOnline || false) : false,
          lastActive: userPresence?.lastActive || null
        } : null
      };
    }));
  }

  async startDM(currentUserId: string, targetUserId: string) {
    if (!targetUserId || targetUserId === currentUserId) {
      throw new ForbiddenException('Cannot start a DM with yourself');
    }

    const isBlocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: currentUserId }
        ]
      }
    });
    if (isBlocked) {
      throw new ForbiddenException('Cannot start a conversation with a blocked user');
    }

    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DM',
        AND: [
          { participants: { some: { userId: currentUserId, deletedAt: null } } },
          { participants: { some: { userId: targetUserId, deletedAt: null } } }
        ]
      }
    });

    if (existing) {
      const pubId = (existing as any).publicId || existing.id;
      return { id: pubId, publicId: pubId };
    }

    const newPubId = generatePublicId();
    const conv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        type: 'DM',
        participants: {
          create: [
            { userId: currentUserId, role: 'OWNER' },
            { userId: targetUserId, role: 'MEMBER' }
          ]
        }
      }
    });

    return { id: newPubId, publicId: newPubId };
  }

  async createInstantMatchDM(userAId: string, userBId: string, activity: string) {
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
}
