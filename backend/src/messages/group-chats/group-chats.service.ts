import { Injectable, ForbiddenException, Optional } from '@nestjs/common';
import type { Conversation } from '@prisma/client';
import {
  assertGroupAuthority,
  groupAsSeenBy,
  membershipChangedAt,
} from '../core/group-membership';
import { resolveViewerPreviews, viewerUpdatedAt } from '../core/viewer-preview';
import { MessagingCoreService } from '../core/messaging-core.service';
import {
  isUnavailableUser,
  presentUserAvatar,
  DELETED_USER_DISPLAY_NAME,
  DELETED_USER_USERNAME,
} from '../../common/users/deleted-user';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../users/blocks.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { RedisService } from '../../redis/redis.service';
import { generatePublicId } from '../../common/utils/public-id.util';
import { MentionsService } from '../../mentions/mentions.service';
import { MediaCleanupService } from '../../uploads/media-cleanup.service';
import { VerificationAccessService } from '../../common/verification/verification-access.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { assertNewConversationWithinRateLimit } from '../core/message-limits';
import {
  UpdateGroupSettingsDto,
  pickGroupSettings,
} from '../dto/update-group-settings.dto';
import {
  conversationListFirstPageKeys,
  groupDetailsVersionKey,
} from '../conversation-list-cache';

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

  /** Sends through this service are locked per client message id. */
  protected override sendLockService(): RedisService | undefined {
    return this.redisService;
  }

  async invalidateUserConversationsCache(userIds?: string[]) {
    const redis = this.redis;
    if (!redis) return;
    try {
      if (userIds && userIds.length > 0) {
        // A direct DEL of the pages clients refetch, like the other evictors.
        // A SCAN walks the whole keyspace — the one the job queues live in —
        // per participant; deeper and searched pages expire with the TTL.
        await redis.del(...userIds.flatMap(conversationListFirstPageKeys));
      } else {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(
            cursor,
            'MATCH',
            'user:conversations:*',
            'COUNT',
            100,
          );
          cursor = nextCursor;
          if (keys && keys.length > 0) await redis.del(...keys);
        } while (cursor !== '0');
      }
    } catch {
      // Best effort cache sweep; stale entries expire on their own.
    }
  }

  async getUserGroupConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        conversation: { type: 'GROUP' },
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
    });

    // The viewer's own preview where the group's shared one is not theirs to
    // see (left the group, or deleted that message for themselves).
    const viewerPreviews = await resolveViewerPreviews(
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

    return participants.map((p) => {
      const conv = p.conversation;
      const pubId = conv.publicId || conv.id;
      const seen = groupAsSeenBy(p, {
        name: conv.name,
        avatarKey: conv.avatarKey,
        description: conv.description,
        memberCount: conv._count?.participants || 0,
      });
      // Nothing counts in a group the viewer is no longer in.
      const unreadCount = p.leftAt ? 0 : p.unreadCount || 0;

      // The last-message preview lives on the Conversation row and is therefore
      // shared by both participants — but Clear and Delete are per-user. Left
      // unguarded, a user who cleared the chat still saw the other person's
      // last message sitting in their list row, quoting content that no longer
      // exists for them anywhere else. Hide any preview at or before this
      // user's own cutoff; the next message they actually receive is after it
      // and shows normally.
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
        type: 'GROUP' as const,
        isGroup: true,
        isMember: p.leftAt == null,
        membershipChangedAt: membershipChangedAt(p),
        ownerId: conv.ownerId || null,
        name: seen.name,
        avatar: seen.avatar,
        avatarKey: seen.avatar,
        description: seen.description,
        status: conv.status || 'ACTIVE',
        createdAt: conv.createdAt,
        updatedAt: viewerUpdatedAt(conv.updatedAt, p.leftAt),
        whoCanJoin: conv.whoCanJoin || 'ANYONE',
        visibility: conv.visibility || 'PUBLIC',
        allowSharing: conv.allowSharing !== false,
        editGroupPermission: conv.editGroupPermission || 'ADMIN',
        groupUpdatesActive: p.groupUpdatesActive !== false,
        pendingRequests: [],
        admins: [],
        members: [],
        memberCount: seen.memberCount,
        pinned: p.isPinned || false,
        pinnedAt: p.pinnedAt || null,
        muted: p.isMuted || false,
        unreadCount,
        unread: unreadCount,
        lastMessage: resolvedLastMsg,
      };
    });
  }

  async createGroup(
    userIds: string[],
    currentUserId: string,
    groupName: string,
  ) {
    // A group additionally fans invitations and notifications out to everyone
    // in the founding roster, so it spends both budgets.
    await assertNewConversationWithinRateLimit(
      this.rateLimit,
      currentUserId,
      true,
    );
    const filteredUserIds = (userIds || []).filter(
      (id) => id && id !== currentUserId,
    );
    const allParticipantIds = [...new Set([...filteredUserIds, currentUserId])];

    // Everyone in the founding roster must be eligible. Once the group exists
    // a member whose verification later lapses only loses the ability to post
    // (see the send-time check) — the group is not dissolved around them.
    await this.verificationAccess.assertUsersEligible(
      allParticipantIds,
      currentUserId,
    );

    const participantRows = allParticipantIds.map((id) => ({
      userId: id,
      role: id === currentUserId ? ('OWNER' as const) : ('MEMBER' as const),
    }));

    const newPubId = generatePublicId();
    const conv = await this.prisma.conversation.create({
      data: {
        publicId: newPubId,
        name: groupName || 'New Group',
        type: 'GROUP',
        ownerId: currentUserId,
        participants: {
          create: participantRows,
        },
      },
    });

    void this.invalidateUserConversationsCache(allParticipantIds);

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

  async getBatchUnblockedAndUnmutedParticipants(
    conversationId: string,
    senderId: string,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: realConvId, deletedAt: null },
      select: { userId: true, isMuted: true },
    });

    const otherIds = participants
      .map((p) => p.userId)
      .filter((id) => id !== senderId);
    // Only the NOTIFICATION fan-out is trimmed here. Group messages themselves
    // stay visible to everyone — hiding them would tear holes in a shared
    // conversation for people who are not party to the block.
    const unblockedIds = await this.blocksService.filterBlockedUsers(
      senderId,
      otherIds,
    );
    const muteMap = new Map(participants.map((p) => [p.userId, p.isMuted]));
    const unmutedIds = unblockedIds.filter((id) => !muteMap.get(id));

    return { recipientIds: unblockedIds, unmutedRecipientIds: unmutedIds };
  }

  // ─── getGroupDetails cache (version-counter invalidation) ───────────────────
  // Per-(conv,user) payload cached briefly. A single INCR of the conv's version
  // key atomically invalidates every member's cached variant with no SCAN — so
  // any membership/role/settings change is reflected on the next fetch.
  private groupDetailsVerKey(realConvId: string) {
    return groupDetailsVersionKey(realConvId);
  }
  private groupDetailsDataKey(realConvId: string, userId: string, ver: string) {
    return `groupDetails:${realConvId}:${userId}:v${ver}`;
  }
  private async _invalidateGroupDetailsByRealId(realConvId: string) {
    if (!this.redis) return;
    try {
      await this.redis.incr(this.groupDetailsVerKey(realConvId));
    } catch {
      // A version counter that fails to bump serves stale details until the 15s TTL, which beats failing the caller.
    }
  }
  /** Bumps the group-details cache version (see getGroupDetails). */
  protected override async invalidateGroupDetailsVersion(
    realConvId: string,
  ): Promise<void> {
    await this._invalidateGroupDetailsByRealId(realConvId);
  }

  async invalidateGroupDetailsCache(conversationId: string) {
    const realConvId = await this.resolveConversationId(conversationId);
    await this._invalidateGroupDetailsByRealId(realConvId);
  }

  async getGroupDetails(conversationId: string, userId: string) {
    const realConvId = await this.resolveConversationId(conversationId);

    if (this.redis) {
      try {
        const ver =
          (await this.redis.get(this.groupDetailsVerKey(realConvId))) || '0';
        const cached = await this.redis.get(
          this.groupDetailsDataKey(realConvId, userId, ver),
        );
        // This same response, JSON-serialized below; dates come back as the
        // ISO strings the fresh response is sent as anyway.
        if (cached) return JSON.parse(cached) as typeof result;
      } catch {
        // A cache miss and an unreachable Redis are the same thing here: rebuild the response.
      }
    }

    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: realConvId,
        type: 'GROUP',
      },
      include: {
        participants: {
          where: { leftAt: null, deletedAt: null },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
                // Required by the tombstone projection below; without them a
                // deleted member's real name and photo render in the group
                // details panel and every participant picker built from it.
                accountStatus: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (!conv) {
      throw new ForbiddenException('Group not found or you are not a member');
    }

    const participants = conv.participants || [];
    const myParticipant = participants.find((p) => p.userId === userId);
    if (!myParticipant) {
      throw new ForbiddenException('Group not found or you are not a member');
    }

    const groupAvatar = conv.avatarKey || null;

    // Pending requests, for the owner and admins only: they are who review
    // them. Every member used to receive the list (names, handles and photos
    // of people who asked to join), and saw a Requests page they could not
    // act on. The response is cached per viewer, so this holds. A request
    // waits until it is answered; answered ones stay as rows (the admins'
    // timeline reads them) but are not pending.
    const canReview =
      myParticipant.role === 'OWNER' || myParticipant.role === 'ADMIN';
    const pendingJoinRequests = !canReview
      ? []
      : await this.prisma.conversationJoinRequest.findMany({
          where: { conversationId: conv.id, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        });

    // Deterministic role order: OWNER (0), ADMIN (1), MEMBER (2)
    const roleRank = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    const sortedParticipants = [...participants].sort((a, b) => {
      const rankA = roleRank[a.role] ?? 99;
      const rankB = roleRank[b.role] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      const nameA = (
        a.user?.displayName ||
        a.user?.username ||
        ''
      ).toLowerCase();
      const nameB = (
        b.user?.displayName ||
        b.user?.username ||
        ''
      ).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const admins = sortedParticipants
      .filter((p) => p.role === 'ADMIN')
      .map((p) => p.userId);
    const members = sortedParticipants
      .filter((p) => p.role === 'MEMBER')
      .map((p) => p.userId);

    // A member who deleted their account keeps their row — removing it would
    // silently rewrite the group's history and its member count for everyone
    // else — but is presented as the tombstone, and flagged so the client
    // renders the name as plain text with no profile link.
    const memberDetails = sortedParticipants.map((p) => {
      const unavailable = isUnavailableUser(p.user);
      return {
        userId: p.userId,
        role: p.role,
        displayName: unavailable
          ? DELETED_USER_DISPLAY_NAME
          : p.user?.displayName || p.user?.username || 'Member',
        username: unavailable ? DELETED_USER_USERNAME : p.user?.username || '',
        avatar: presentUserAvatar(p.user),
        isDeleted: unavailable,
        profileAvailable: !unavailable,
      };
    });

    const pendingRequests = pendingJoinRequests.map((req) => ({
      id: req.id,
      userId: req.userId,
      username: req.user?.username || '',
      displayName: req.user?.displayName || req.user?.username || '',
      avatar: req.user?.avatar || null,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt,
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
      type: conv.type,
    };

    if (this.redis) {
      try {
        const ver =
          (await this.redis.get(this.groupDetailsVerKey(realConvId))) || '0';
        this.redis
          .setex(
            this.groupDetailsDataKey(realConvId, userId, ver),
            15,
            JSON.stringify(result),
          )
          .catch(() => {});
      } catch {
        // Writing the cache is an optimisation; the response is already built.
      }
    }

    return result;
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

    const [participant, conversation, user] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
      }),
      this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: {
          id: true,
          name: true,
          description: true,
          avatarKey: true,
          editGroupPermission: true,
          publicId: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true },
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

    const participantIds = participantRows.map((p) => p.userId);
    void this.invalidateUserConversationsCache(participantIds);
    this._invalidateGroupDetailsByRealId(realConvId).catch(() => {});

    const rawName = user?.username || user?.displayName || 'Someone';
    const actorHandle = rawName.startsWith('@') ? rawName : `@${rawName}`;

    return {
      updated,
      convBefore: conversation,
      actorHandle,
      participantIds,
    };
  }

  async updateGroupSettings(
    conversationId: string,
    userId: string,
    data: UpdateGroupSettingsDto,
  ) {
    const realConvId = await this.resolveConversationId(conversationId);

    // Auth check FIRST — validate membership before any mutation. The values
    // before the change are read alongside, so the controller can tell the
    // group what actually changed (and say nothing for a no-op save).
    const [participant, before] = await Promise.all([
      this.prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: { userId, conversationId: realConvId },
        },
      }),
      this.prisma.conversation.findUnique({
        where: { id: realConvId },
        select: { whoCanJoin: true, editGroupPermission: true },
      }),
    ]);
    if (!participant || participant.leftAt || participant.deletedAt) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    // groupUpdatesActive is per-user — any member can toggle their own notification setting
    const groupUpdatesActive = data.groupUpdatesActive;

    // Whitelist admin-editable settings. Never spread the raw body into
    // conversation.update — that would let an admin mass-assign ANY column
    // (ownerId, status, type, expiresAt, lastMessageText, isInstantMatch, …).
    const restData = pickGroupSettings(data);

    // Admin-only fields require OWNER or ADMIN role
    if (Object.keys(restData).length > 0) {
      if (participant.role !== 'OWNER' && participant.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Only group admins can update these settings',
        );
      }
    }

    // The caller's own notification switch, when they sent one.
    const participantUpdate =
      groupUpdatesActive !== undefined
        ? this.prisma.conversationParticipant.update({
            where: {
              userId_conversationId: { userId, conversationId: realConvId },
            },
            data: { groupUpdatesActive },
          })
        : Promise.resolve(null);

    const updateConvPromise =
      Object.keys(restData).length > 0
        ? this.prisma.conversation.update({
            where: { id: realConvId },
            data: restData,
            select: {
              id: true,
              publicId: true,
              whoCanJoin: true,
              visibility: true,
              allowSharing: true,
              editGroupPermission: true,
            },
          })
        : this.prisma.conversation.findUnique({
            where: { id: realConvId },
            select: {
              id: true,
              publicId: true,
              whoCanJoin: true,
              visibility: true,
              allowSharing: true,
              editGroupPermission: true,
            },
          });

    // Same three queries, run together, in the same order as before.
    const [, updatedConv, participantRows] = await Promise.all([
      participantUpdate,
      updateConvPromise,
      this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, leftAt: null, deletedAt: null },
        select: { userId: true },
      }),
    ]);
    const participantIds = (participantRows || []).map((p) => p.userId);
    void this.invalidateUserConversationsCache(participantIds);
    this._invalidateGroupDetailsByRealId(realConvId).catch(() => {});

    return {
      success: true,
      conversationId: realConvId,
      updatedConv,
      before,
      participantIds,
    };
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
    const before = await this.prisma.conversation.findUnique({
      where: { id: realConvId },
      select: { editGroupPermission: true },
    });
    const [updatedConv, participantRows] = await Promise.all([
      this.prisma.conversation.update({
        where: { id: realConvId },
        data: { editGroupPermission: permission },
        select: { id: true, publicId: true, editGroupPermission: true },
      }),
      this.prisma.conversationParticipant.findMany({
        where: { conversationId: realConvId, leftAt: null, deletedAt: null },
        select: { userId: true },
      }),
    ]);

    const participantIds = participantRows.map((p) => p.userId);
    void this.invalidateUserConversationsCache(participantIds);
    this._invalidateGroupDetailsByRealId(realConvId).catch(() => {});

    return {
      success: true,
      conversationId: realConvId,
      updatedConv,
      before,
      participantIds,
    };
  }

  // changeGroupOwner / promoteToAdmin / demoteFromAdmin / endGroup and the
  // join-request decisions (acceptGroupJoinRequest / declineGroupJoinRequest)
  // are inherited from MessagingCoreService (single source of truth).
}
