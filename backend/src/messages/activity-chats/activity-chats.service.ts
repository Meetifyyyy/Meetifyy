import { Injectable, NotFoundException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { MessagingCoreService } from '../core/messaging-core.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { generatePublicId } from '../../common/utils/public-id.util';

@Injectable()
export class ActivityChatsService extends MessagingCoreService {
  constructor(
    prisma: PrismaService,
    presenceService: PresenceService,
    domainEventService: DomainEventService,
  ) {
    super(prisma, presenceService, domainEventService);
  }

  async resolveActivityConversationId(activityIdOrConvId: string): Promise<string> {
    if (!activityIdOrConvId) return activityIdOrConvId;
    const cleanId = activityIdOrConvId.replace(/^act_/, '');

    // 1. Try finding conversation by activityId or publicId or id
    const found = await this.prisma.conversation.findFirst({
      where: {
        OR: [
          { activityId: cleanId },
          { publicId: activityIdOrConvId },
          { id: activityIdOrConvId },
          { id: cleanId },
          { publicId: `act_${cleanId}` }
        ]
      },
      select: { id: true }
    });

    if (found) {
      return found.id;
    }

    return activityIdOrConvId;
  }

  async getUserActivityConversations(userId: string, limit: number = 20, offset: number = 0) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        conversation: {
          OR: [
            { type: 'ACTIVITY' as any },
            { isActivityChat: true },
            { activityId: { not: null } }
          ]
        }
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
            isActivityChat: true,
            activityId: true,
            createdAt: true,
            updatedAt: true,
            activity: {
              select: {
                id: true,
                title: true,
                startDate: true,
                status: true,
                creatorId: true,
                coverImage: true,
              }
            },
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

    return Promise.all(participants.map(async (p) => {
      const conv = p.conversation;
      const allParticipants = conv.participants || [];
      const lastMsgInfo = lastMsgMap.get(conv.id);
      const unreadCount = unreadMap.get(conv.id) || 0;
      const pubId = (conv as any).publicId || `act_${conv.activityId || conv.id}`;

      const actStartDate = conv.activity?.startDate;
      const actStatus = (conv.activity?.status || conv.status || '').toUpperCase();
      const hasStarted = ['IN_PROGRESS', 'STARTED', 'COMPLETED', 'ENDED', 'CLOSED', 'CANCELLED'].includes(actStatus) || (!!actStartDate && new Date(actStartDate) <= new Date());

      return {
        id: pubId,
        publicId: pubId,
        internalId: conv.id,
        type: 'ACTIVITY' as const,
        isActivityChat: true,
        activityId: conv.activityId || (conv.activity ? conv.activity.id : null),
        activity: conv.activity || null,
        hasStarted,
        activityHasStarted: hasStarted,
        isMember: (p as any).leftAt == null,
        ownerId: conv.ownerId || (conv.activity ? conv.activity.creatorId : null),
        name: conv.name || conv.activity?.title || 'Activity Chat',
        avatar: conv.avatarKey || conv.activity?.coverImage || null,
        description: conv.description || null,
        status: conv.status || 'ACTIVE',
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        pinned: p.isPinned || false,
        muted: p.isMuted || false,
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
      };
    }));
  }

  async initializeActivityChat(activityId: string, currentUserId: string) {
    const cleanId = activityId.replace(/^act_/, '');
    const activity = await this.prisma.crewActivity.findUnique({
      where: { id: cleanId },
      include: { members: true }
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    let existing = await this.prisma.conversation.findFirst({
      where: {
        OR: [
          { activityId: cleanId },
          { publicId: `act_${cleanId}` },
          { id: cleanId }
        ]
      }
    });

    if (existing) {
      // Ensure user is participant
      await this.prisma.conversationParticipant.upsert({
        where: { userId_conversationId: { userId: currentUserId, conversationId: existing.id } },
        create: { userId: currentUserId, conversationId: existing.id, role: currentUserId === activity.creatorId ? 'OWNER' : 'MEMBER' },
        update: { leftAt: null, deletedAt: null } as any
      });
      return { id: existing.publicId || existing.id, publicId: existing.publicId || existing.id };
    }

    const newPubId = `act_${cleanId}`;
    const participantCreate = [
      { userId: activity.creatorId, role: 'OWNER' as const },
      ...activity.members
        .filter(m => m.userId !== activity.creatorId)
        .map(m => ({ userId: m.userId, role: 'MEMBER' as const }))
    ];

    if (!participantCreate.some(p => p.userId === currentUserId)) {
      participantCreate.push({ userId: currentUserId, role: 'MEMBER' as const });
    }

    const newConv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        name: activity.title,
        type: 'ACTIVITY' as any,
        isActivityChat: true,
        activityId: cleanId,
        ownerId: activity.creatorId,
        participants: {
          create: participantCreate
        }
      }
    });

    return { id: newPubId, publicId: newPubId };
  }
}
