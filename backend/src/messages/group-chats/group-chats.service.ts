import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Inject, forwardRef, Optional } from '@nestjs/common';
import { MessagingCoreService } from '../core/messaging-core.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../users/blocks.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { RedisService } from '../../redis/redis.service';
import { generatePublicId } from '../../common/utils/public-id.util';
import { MentionsService } from '../../mentions/mentions.service';

@Injectable()
export class GroupChatsService extends MessagingCoreService {
  private readonly redis: ReturnType<RedisService['getClient']>;

  constructor(
    prisma: PrismaService,
    presenceService: PresenceService,
    domainEventService: DomainEventService,
    mentionsService: MentionsService,
    // Required (and ahead of the optional param): block filtering of the
    // notification fan-out runs through it on every group send.
    blocksService: BlocksService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    super(prisma, presenceService, domainEventService, mentionsService, blocksService);
    this.redis = this.redisService?.getClient() ?? null;
  }

  async invalidateUserConversationsCache(userIds?: string[]) {
    const redis = this.redis;
    if (!redis) return;
    try {
      if (userIds && userIds.length > 0) {
        await Promise.all(
          userIds.map(async (uId) => {
            let cursor = '0';
            do {
              const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `user:conversations:${uId}:*`, 'COUNT', 50);
              cursor = nextCursor;
              if (keys && keys.length > 0) await redis.del(...keys);
            } while (cursor !== '0');
          })
        );
      } else {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'user:conversations:*', 'COUNT', 100);
          cursor = nextCursor;
          if (keys && keys.length > 0) await redis.del(...keys);
        } while (cursor !== '0');
      }
    } catch {}
  }

  async getUserGroupConversations(userId: string, limit: number = 20, offset: number = 0) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        conversation: { type: 'GROUP' }
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
            createdAt: true,
            updatedAt: true,
            whoCanJoin: true,
            visibility: true,
            allowSharing: true,
            editGroupPermission: true,
            _count: { 
              select: { 
                participants: { 
                  where: { leftAt: null, deletedAt: null } 
                } 
              } 
            }
          }
        }
      }
    });

    return (participants as any[]).map((p: any) => {
      const conv = p.conversation;
      const pubId = conv.publicId || conv.id;
      const groupAvatar = conv.avatarKey || null;
      const unreadCount = p.unreadCount || 0;

      // The last-message preview lives on the Conversation row and is therefore
      // shared by both participants — but Clear and Delete are per-user. Left
      // unguarded, a user who cleared the chat still saw the other person's
      // last message sitting in their list row, quoting content that no longer
      // exists for them anywhere else. Hide any preview at or before this
      // user's own cutoff; the next message they actually receive is after it
      // and shows normally.
      const cutoff = (p as any).clearedAt as Date | null;
      const previewCleared = Boolean(
        cutoff && conv.lastMessageAt && new Date(conv.lastMessageAt) <= new Date(cutoff)
      );

      const resolvedLastMsg = (conv.lastMessageAt && !previewCleared) ? {
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
        isGroup: true,
        isMember: p.leftAt == null,
        ownerId: conv.ownerId || null,
        name: conv.name || 'Group',
        avatar: groupAvatar,
        avatarKey: groupAvatar,
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
        pinnedAt: p.pinnedAt || null,
        muted: p.isMuted || false,
        unreadCount,
        unread: unreadCount,
        lastMessage: resolvedLastMsg,
      };
    });
  }

  async createGroup(userIds: string[], currentUserId: string, groupName: string) {
    const filteredUserIds = (userIds || []).filter(id => id && id !== currentUserId);
    const allParticipantIds = [...new Set([...filteredUserIds, currentUserId])];
    const participantRows = allParticipantIds.map(id => ({
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
          create: participantRows
        }
      }
    });

    this.invalidateUserConversationsCache(allParticipantIds);

    // Return full conversation shape so frontend can render immediately
    return {
      id: newPubId,
      publicId: newPubId,
      internalId: conv.id,
      name: groupName || 'New Group',
      type: 'GROUP' as const,
      isGroup: true,
      ownerId: currentUserId,
      status: 'ACTIVE',
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      memberCount: allParticipantIds.length,
      members: [],
      admins: [],
      avatar: null,
      avatarKey: null,
      description: null,
      whoCanJoin: 'ANYONE',
      visibility: 'PUBLIC',
      allowSharing: true,
      editGroupPermission: 'ADMIN',
      lastMessage: null,
      unreadCount: 0,
      unread: 0,
      isMember: true,
      pinned: false,
      muted: false,
      groupUpdatesActive: true,
    };
  }

  async getBatchUnblockedAndUnmutedParticipants(conversationId: string, senderId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, deletedAt: null },
      select: { userId: true, isMuted: true }
    });

    const otherIds = participants.map(p => p.userId).filter(id => id !== senderId);
    // Only the NOTIFICATION fan-out is trimmed here. Group messages themselves
    // stay visible to everyone — hiding them would tear holes in a shared
    // conversation for people who are not party to the block.
    const unblockedIds = await this.blocksService.filterBlockedUsers(senderId, otherIds);
    const muteMap = new Map(participants.map(p => [p.userId, p.isMuted]));
    const unmutedIds = unblockedIds.filter(id => !muteMap.get(id));

    return { recipientIds: unblockedIds, unmutedRecipientIds: unmutedIds };
  }

  // ─── getGroupDetails cache (version-counter invalidation) ───────────────────
  // Per-(conv,user) payload cached briefly. A single INCR of the conv's version
  // key atomically invalidates every member's cached variant with no SCAN — so
  // any membership/role/settings change is reflected on the next fetch.
  private groupDetailsVerKey(realConvId: string) {
    return `groupDetails:ver:${realConvId}`;
  }
  private groupDetailsDataKey(realConvId: string, userId: string, ver: string) {
    return `groupDetails:${realConvId}:${userId}:v${ver}`;
  }
  private async _invalidateGroupDetailsByRealId(realConvId: string) {
    if (!this.redis) return;
    try { await this.redis.incr(this.groupDetailsVerKey(realConvId)); } catch {}
  }
  async invalidateGroupDetailsCache(conversationId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    await this._invalidateGroupDetailsByRealId(realConvId);
  }

  async getGroupDetails(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);

    if (this.redis) {
      try {
        const ver = (await this.redis.get(this.groupDetailsVerKey(realConvId))) || '0';
        const cached = await this.redis.get(this.groupDetailsDataKey(realConvId, userId, ver));
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: realConvId,
        type: 'GROUP'
      },
      include: {
        participants: {
          where: { leftAt: null, deletedAt: null },
          include: {
            user: { select: { id: true, username: true, displayName: true, avatar: true } }
          }
        }
      }
    });

    if (!conv) {
      throw new ForbiddenException('Group not found or you are not a member');
    }

    const participants = (conv as any).participants || [];
    const myParticipant = participants.find((p: any) => p.userId === userId);
    if (!myParticipant) {
      throw new ForbiddenException('Group not found or you are not a member');
    }

    const groupAvatar = conv.avatarKey || null;

    // Filter out expired pending requests
    const now = new Date();
    const pendingJoinRequests = await this.prisma.conversationJoinRequest.findMany({
      where: {
        conversationId: conv.id,
        status: 'PENDING',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true } }
      }
    });

    // Clean up expired join requests in background
    setImmediate(async () => {
      await this.prisma.conversationJoinRequest.deleteMany({
        where: {
          conversationId: conv.id,
          status: 'PENDING',
          expiresAt: { lte: now }
        }
      }).catch(() => {});
    });

    // Deterministic role order: OWNER (0), ADMIN (1), MEMBER (2)
    const roleRank = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    const sortedParticipants = [...participants].sort((a: any, b: any) => {
      const rankA = roleRank[a.role as keyof typeof roleRank] ?? 99;
      const rankB = roleRank[b.role as keyof typeof roleRank] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      const nameA = (a.user?.displayName || a.user?.username || '').toLowerCase();
      const nameB = (b.user?.displayName || b.user?.username || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const admins = sortedParticipants.filter((p: any) => p.role === 'ADMIN').map((p: any) => p.userId);
    const members = sortedParticipants.filter((p: any) => p.role === 'MEMBER').map((p: any) => p.userId);

    const memberDetails = sortedParticipants.map((p: any) => ({
      userId: p.userId,
      role: p.role,
      displayName: p.user?.displayName || p.user?.username || 'Member',
      username: p.user?.username || '',
      avatar: p.user?.avatar || null
    }));

    const pendingRequests = pendingJoinRequests.map((req: any) => ({
      id: req.id,
      userId: req.userId,
      username: req.user?.username || '',
      displayName: req.user?.displayName || req.user?.username || '',
      avatar: req.user?.avatar || null,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt
    }));

    const pubId = conv.publicId || conv.id;

    const result = {
      id: pubId,
      publicId: pubId,
      internalId: conv.id,
      name: conv.name || 'Group',
      avatar: groupAvatar,
      avatarKey: conv.avatarKey || null,
      description: conv.description || null,
      ownerId: conv.ownerId,
      whoCanJoin: conv.whoCanJoin || 'ANYONE',
      visibility: conv.visibility || 'PUBLIC',
      allowSharing: conv.allowSharing !== false,
      editGroupPermission: conv.editGroupPermission || 'ADMIN',
      groupUpdatesActive: myParticipant.groupUpdatesActive !== false,
      myRole: myParticipant.role,
      admins,
      members,
      memberDetails,
      memberCount: sortedParticipants.length,
      pendingRequests,
      status: conv.status || 'ACTIVE',
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      type: conv.type
    };

    if (this.redis) {
      try {
        const ver = (await this.redis.get(this.groupDetailsVerKey(realConvId))) || '0';
        this.redis.setex(this.groupDetailsDataKey(realConvId, userId, ver), 15, JSON.stringify(result)).catch(() => {});
      } catch {}
    }

    return result;
  }

  async updateGroupInfo(conversationId: string, userId: string, data: { name?: string; description?: string; avatarKey?: string; avatar?: string }) {
    const realConvId = await this.resolveConversationId(conversationId);

    const [participant, conversation, user] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId, conversationId: realConvId } }
      }),
      this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { id: true, name: true, description: true, avatarKey: true, editGroupPermission: true, publicId: true }
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
      })
    ]);

    const participantIds = participantRows.map(p => p.userId);
    this.invalidateUserConversationsCache(participantIds);
    this._invalidateGroupDetailsByRealId(realConvId).catch(() => {});

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

    // Block enforcement: don't let a member pull someone they've blocked (or who
    // blocked them) into a shared group.
    if (await this.blocksService.isBlocked(requesterId, targetUserId)) {
      // Neutral by design. The earlier wording named the block relationship
      // outright and so disclosed it to the caller. The reason is withheld
      // here, exactly as it is on every other blocked surface.
      throw new ForbiddenException('This user is not available to add to the group.');
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
        where: { conversationId: realConvId, deletedAt: null, leftAt: null, role: 'ADMIN' },
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
          where: { conversationId: realConvId, deletedAt: null, leftAt: null, userId: { not: userId } },
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

    // Auth check FIRST — validate membership before any mutation
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || participant.leftAt || participant.deletedAt) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    // groupUpdatesActive is per-user — any member can toggle their own notification setting
    const groupUpdatesActive = data.groupUpdatesActive;

    // Whitelist admin-editable settings. Never spread the raw body into
    // conversation.update — that would let an admin mass-assign ANY column
    // (ownerId, status, type, expiresAt, lastMessageText, isInstantMatch, …).
    const ALLOWED_SETTINGS = ['whoCanJoin', 'visibility', 'allowSharing', 'editGroupPermission'] as const;
    const restData: any = {};
    for (const key of ALLOWED_SETTINGS) {
      if (data[key] !== undefined) restData[key] = data[key];
    }

    // Admin-only fields require OWNER or ADMIN role
    if (Object.keys(restData).length > 0) {
      if (participant.role !== 'OWNER' && participant.role !== 'ADMIN') {
        throw new ForbiddenException('Only group admins can update these settings');
      }
    }

    const ops: Promise<any>[] = [];

    if (groupUpdatesActive !== undefined) {
      ops.push(
        this.prisma.conversationParticipant.update({
          where: { userId_conversationId: { userId, conversationId: realConvId } },
          data: { groupUpdatesActive }
        })
      );
    }

    const updateConvPromise = Object.keys(restData).length > 0
      ? this.prisma.conversation.update({
          where: { id: realConvId },
          data: restData,
          select: { id: true, publicId: true, whoCanJoin: true, visibility: true, allowSharing: true, editGroupPermission: true }
        })
      : this.prisma.conversation.findUnique({
          where: { id: realConvId },
          select: { id: true, publicId: true, whoCanJoin: true, visibility: true, allowSharing: true, editGroupPermission: true }
        });

    ops.push(updateConvPromise);
    ops.push(
      this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, leftAt: null, deletedAt: null },
        select: { userId: true }
      })
    );

    const results = await Promise.all(ops);
    const updatedConv = results[results.length - 2];
    const participantRows = results[results.length - 1] || [];
    const participantIds = participantRows.map((p: any) => p.userId);
    this.invalidateUserConversationsCache(participantIds);
    this._invalidateGroupDetailsByRealId(realConvId).catch(() => {});

    return { success: true, conversationId: realConvId, updatedConv, participantIds };
  }

  async updateGroupEditPermission(conversationId: string, userId: string, permission: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || (participant.role !== 'OWNER' && participant.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can update settings');
    }
    const [updatedConv, participantRows] = await Promise.all([
      this.prisma.conversation.update({
        where: { id: realConvId },
        data: { editGroupPermission: permission },
        select: { id: true, publicId: true, editGroupPermission: true }
      }),
      this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, leftAt: null, deletedAt: null },
        select: { userId: true }
      })
    ]);

    const participantIds = participantRows.map(p => p.userId);
    this.invalidateUserConversationsCache(participantIds);
    this._invalidateGroupDetailsByRealId(realConvId).catch(() => {});

    return { success: true, conversationId: realConvId, updatedConv, participantIds };
  }

  // changeGroupOwner / promoteToAdmin / demoteFromAdmin / endGroup are inherited
  // from MessagingCoreService (single source of truth, with target validation).

  async acceptGroupJoinRequest(conversationId: string, userId: string, targetUserId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId: realConvId } }
    });
    if (!participant || (participant.role !== 'OWNER' && participant.role !== 'ADMIN')) {
      throw new ForbiddenException('Only group admins can accept requests');
    }

    const joinRequest = await this.prisma.conversationJoinRequest.findUnique({
      where: { conversationId_userId: { conversationId: realConvId, userId: targetUserId } }
    });
    
    if (!joinRequest) {
      throw new NotFoundException('Join request not found');
    }
    
    if (joinRequest.expiresAt && joinRequest.expiresAt < new Date()) {
      await this.prisma.conversationJoinRequest.delete({
        where: { conversationId_userId: { conversationId: realConvId, userId: targetUserId } }
      });
      throw new BadRequestException('Join request has expired');
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

    const convStatus = String(conversation.status || '').toUpperCase();
    if (convStatus === 'CLOSED' || convStatus === 'ENDED') {
      throw new BadRequestException('This group is closed and no longer accepts new members');
    }

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

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    await this.prisma.conversationJoinRequest.upsert({
      where: { conversationId_userId: { conversationId: realConvId, userId } },
      create: { conversationId: realConvId, userId, status: 'PENDING', expiresAt },
      update: { status: 'PENDING', expiresAt }
    });

    return { status: 'PENDING' };
  }
}
