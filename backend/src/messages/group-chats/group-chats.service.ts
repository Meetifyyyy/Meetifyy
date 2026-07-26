import { Injectable, ForbiddenException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { MessagingCoreService } from '../core/messaging-core.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from '../../presence/presence.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { generatePublicId } from '../../common/utils/public-id.util';

@Injectable()
export class GroupChatsService extends MessagingCoreService {
  constructor(
    prisma: PrismaService,
    presenceService: PresenceService,
    @Inject(forwardRef(() => RealtimeGateway))
    realtimeGateway: RealtimeGateway,
  ) {
    super(prisma, presenceService, realtimeGateway);
  }

  async getUserGroupConversations(userId: string, limit: number = 20, offset: number = 0) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        conversation: { type: 'GROUP' }
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
            createdAt: true,
            updatedAt: true,
            whoCanJoin: true,
            visibility: true,
            allowSharing: true,
            editGroupPermission: true,
            joinRequests: {
              where: { status: 'PENDING' },
              select: {
                userId: true,
                createdAt: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatar: true
                  }
                }
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

    return Promise.all(participants.map(async (p) => {
      const conv = p.conversation;
      const allParticipants = conv.participants || [];
      const getRoleRank = (part: any, ownerId?: string | null) => {
        if ((ownerId && part.userId === ownerId) || part.role === 'OWNER') return 0;
        if (part.role === 'ADMIN') return 1;
        return 2;
      };

      const sortedParticipants = [...allParticipants].sort((a, b) => {
        const rankA = getRoleRank(a, conv.ownerId);
        const rankB = getRoleRank(b, conv.ownerId);
        if (rankA !== rankB) return rankA - rankB;
        const timeA = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
        const timeB = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
        return timeA - timeB;
      });

      const adminsList = sortedParticipants.filter(part => part.role === 'OWNER' || part.role === 'ADMIN').map(part => part.userId);
      const membersList = sortedParticipants.map(part => ({
        userId: part.userId,
        role: part.role,
        joinedAt: part.joinedAt,
        user: part.user
      }));

      const lastMsgInfo = lastMsgMap.get(conv.id);
      const unreadCount = unreadMap.get(conv.id) || 0;
      const pubId = (conv as any).publicId || conv.id;

      return {
        id: pubId,
        publicId: pubId,
        internalId: conv.id,
        type: 'GROUP' as const,
        isMember: (p as any).leftAt == null,
        ownerId: conv.ownerId || null,
        name: conv.name || 'Group',
        avatar: conv.avatarKey || null,
        description: conv.description || null,
        status: conv.status || 'ACTIVE',
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        whoCanJoin: conv.whoCanJoin || 'ANYONE',
        visibility: conv.visibility || 'PUBLIC',
        allowSharing: conv.allowSharing !== false,
        editGroupPermission: conv.editGroupPermission || 'ADMIN',
        groupUpdatesActive: p.groupUpdatesActive !== false,
        pendingRequests: (conv.joinRequests || []).map((r: any) => ({
          userId: r.userId,
          user: r.user ? {
            id: r.user.id,
            username: r.user.username,
            displayName: r.user.displayName,
            avatar: r.user.avatar,
            name: r.user.displayName || r.user.username
          } : null,
          createdAt: r.createdAt
        })),
        admins: adminsList,
        members: membersList,
        memberCount: allParticipants.length,
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

    const avatarVal = data.avatarKey !== undefined ? data.avatarKey : data.avatar;

    const updated = await this.prisma.conversation.update({
      where: { id: realConvId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(avatarVal !== undefined ? { avatarKey: avatarVal } : {}),
      }
    });

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
