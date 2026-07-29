import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { MessagingCoreService } from '../core/messaging-core.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { generatePublicId } from '../../common/utils/public-id.util';

@Injectable()
export class GroupChatsService extends MessagingCoreService {
  constructor(
    prisma: PrismaService,
    presenceService: PresenceService,
    domainEventService: DomainEventService,
  ) {
    super(prisma, presenceService, domainEventService);
  }

  async getUserGroupConversations(userId: string, limit: number = 20, offset: number = 0) {
    const allParticipants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        conversation: { type: 'GROUP' }
      },
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
            ownerId: true,
            status: true,
            activityId: true,
            isActivityChat: true,
            activity: { select: { id: true, title: true, coverImage: true, startDate: true, endDate: true, status: true } },
            lastMessageId: true,
            lastMessageText: true,
            lastMessageType: true,
            lastMessageAt: true,
            lastMessageSenderId: true,
            createdAt: true,
            updatedAt: true,
            whoCanJoin: true,
            visibility: true,
            allowSharing: true,
            editGroupPermission: true,
            _count: { select: { participants: true } }
          }
        }
      }
    });

    (allParticipants as any[]).sort((a: any, b: any) => {
      const timeA = new Date(a.conversation.lastMessageAt || a.conversation.updatedAt || a.conversation.createdAt).getTime();
      const timeB = new Date(b.conversation.lastMessageAt || b.conversation.updatedAt || b.conversation.createdAt).getTime();
      return timeB - timeA;
    });

    const participants = allParticipants.slice(offset, offset + limit);

    return (participants as any[]).map((p: any) => {
      const conv = p.conversation;
      const pubId = conv.publicId || conv.id;
      const groupAvatar = conv.avatarKey || conv.activity?.coverImage || null;
      const actStartDate = conv.activity?.startDate;
      const actStatus = (conv.activity?.status || conv.status || '').toUpperCase();
      const hasStarted = ['IN_PROGRESS', 'STARTED', 'COMPLETED', 'ENDED', 'CLOSED', 'CANCELLED'].includes(actStatus) || (!!actStartDate && new Date(actStartDate) <= new Date());
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
        type: 'GROUP' as const,
        activityId: conv.activityId || null,
        activity: conv.activity || null,
        hasStarted,
        activityHasStarted: hasStarted,
        isActivityChat: conv.type === 'ACTIVITY' || !!conv.activityId,
        isMember: p.leftAt == null,
        ownerId: conv.ownerId || null,
        name: conv.name || conv.activity?.title || 'Group',
        avatar: groupAvatar,
        description: conv.description || null,
        status: conv.status || 'ACTIVE',
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
        memberCount: conv._count?.participants || 0,
        pinned: p.isPinned || false,
        muted: p.isMuted || false,
        unreadCount,
        unread: unreadCount,
        lastMessage: resolvedLastMsg,
      };
    });
  }

  async createGroup(userIds: string[], currentUserId: string, groupName: string) {
    const filteredUserIds = (userIds || []).filter(id => id && id !== currentUserId);
    const participants = [...new Set([...filteredUserIds, currentUserId])].map(id => ({
      userId: id,
      role: id === currentUserId ? ('OWNER' as const) : ('MEMBER' as const)
    }));

    const newPubId = generatePublicId();
    const conv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        name: groupName || 'New Group',
        type: 'GROUP',
        ownerId: currentUserId,
        participants: {
          create: participants
        }
      }
    });

    return { id: newPubId, publicId: newPubId };
  }

  async updateGroupInfo(conversationId: string, userId: string, data: { name?: string; description?: string; avatarKey?: string; avatar?: string }) {
    const realConvId = await this.resolveConversationId(conversationId);

    const [participant, conversation, user] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId, conversationId: realConvId } }
      }),
      this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { id: true, name: true, description: true, avatarKey: true, editGroupPermission: true, activityId: true, publicId: true }
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true }
      })
    ]);

    if (!participant) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    const perm = (conversation?.editGroupPermission || '').toUpperCase();
    const isAllowed = participant.role === 'OWNER' || participant.role === 'ADMIN' || perm === 'EVERYONE' || perm === 'ALL_MEMBERS' || perm === 'ALL';
    if (!isAllowed) {
      throw new ForbiddenException('Only group admins can edit group details');
    }

    let avatarVal = data.avatarKey !== undefined ? data.avatarKey : data.avatar;
    if (avatarVal && typeof avatarVal === 'string' && avatarVal.startsWith('blob:')) {
      avatarVal = undefined;
    }

    const [updated, participantRows] = await Promise.all([
      this.prisma.conversation.update({
        where: { id: realConvId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(avatarVal !== undefined ? { avatarKey: avatarVal } : {}),
        }
      }),
      this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, leftAt: null, deletedAt: null },
        select: { userId: true }
      }),
      conversation?.activityId && avatarVal !== undefined ? this.prisma.crewActivity.update({
        where: { id: conversation.activityId },
        data: { coverImage: avatarVal }
      }).catch(() => {}) : Promise.resolve(null)
    ]);

    const participantIds = participantRows.map(p => p.userId);
    const rawName = user?.username || user?.displayName || 'Someone';
    const actorHandle = rawName.startsWith('@') ? rawName : `@${rawName}`;

    return {
      updated,
      convBefore: conversation,
      actorHandle,
      participantIds
    };
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
      select: { activityId: true, isActivityChat: true }
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

    const [requester, target] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId: requesterId, conversationId: realConvId } }
      }),
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId: targetUserId, conversationId: realConvId } }
      })
    ]);

    if (!requester || (requester.role !== 'OWNER' && requester.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can remove members');
    }

    if (!target || (target as any).leftAt || target.deletedAt) {
      throw new NotFoundException('Member not found in group');
    }

    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the group owner');
    }

    if (requester.role === 'ADMIN' && target.role === 'ADMIN') {
      throw new ForbiddenException('Admins cannot remove other admins. Only the owner can remove admins.');
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

    await this.prisma.conversationParticipant.update({
        where: { userId_conversationId: { userId, conversationId: realConvId } },
        data: { leftAt: new Date() } as any
      });

    if (participant.role === 'OWNER') {
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
}
