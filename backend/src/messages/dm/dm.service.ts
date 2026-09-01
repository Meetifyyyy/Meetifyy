import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { MessagingCoreService } from '../core/messaging-core.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BlocksService } from '../../users/blocks.service';
import { PresenceService } from '../../presence/presence.service';
import { DomainEventService } from '../../events/domain-event.service';
import { generatePublicId } from '../../common/utils/public-id.util';
import { MentionsService } from '../../mentions/mentions.service';
import { VerificationAccessService } from '../../common/verification/verification-access.service';

import { resolvePresenceVisibilityForViewer } from '../../users/privacy.helper';
import {
  isUnavailableUser,
  presentUserName,
  presentUserAvatar,
  DELETED_USER_USERNAME,
} from '../../common/users/deleted-user';

@Injectable()
export class DmService extends MessagingCoreService {
  constructor(
    prisma: PrismaService,
    presenceService: PresenceService,
    domainEventService: DomainEventService,
    mentionsService: MentionsService,
    blocksService: BlocksService,
    verificationAccess: VerificationAccessService,
  ) {
    super(
      prisma,
      presenceService,
      domainEventService,
      mentionsService,
      blocksService,
      verificationAccess,
    );
  }

  async getUserDMConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ) {
    // NOTE: expired instant-match cleanup is handled by the 15-min cron in
    // MessagesService.onModuleInit — a read endpoint must not issue a write
    // (and its row lock) on every list load.
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        deletedAt: null,
        conversation: { type: 'DM' },
      },
      // Without an explicit order, `take`/`skip` paginate an unordered set:
      // rows can repeat or vanish between pages, and a brand-new instant-match
      // chat can land anywhere — including past the end of page one, which
      // looks exactly like the chat not having been created.
      // Pinned rows first (most recently pinned at the top), then by recent
      // activity. Ordering pinned-first in SQL rather than only in the client
      // keeps `take`/`skip` pagination correct: a pin must not be able to
      // strand a conversation on a later page than the one the list shows.
      orderBy: [
        { isPinned: 'desc' },
        { pinnedAt: 'desc' },
        { conversation: { updatedAt: 'desc' } },
      ],
      take: limit,
      skip: offset,
      select: {
        isMuted: true,
        isPinned: true,
        pinnedAt: true,
        clearedAt: true,
        lastReadAt: true,
        unreadCount: true,
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
                    // See MessagesService.getUserConversations: the partner's
                    // eligibility travels with the row so the composer can
                    // render its unavailable state on first paint.
                    verificationStatus: true,
                    // Same reason, for the deletion lifecycle: without these
                    // the list would render a deleted partner's real name and
                    // avatar, and offer a composer that the server refuses.
                    accountStatus: true,
                    deletedAt: true,
                    settings: {
                      select: {
                        showOnlineStatus: true,
                        whoCanSeeOnline: true,
                        readReceipts: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const convIds = participants.map((p) => p.conversation.id);

    // Batched single query for all last messages instead of N+1 Promise.all findFirst
    const recentMessages =
      convIds.length > 0
        ? await this.prisma.message.findMany({
            where: {
              conversationId: { in: convIds },
              deletedAt: null,
            },
            orderBy: { createdAt: 'desc' },
            distinct: ['conversationId'],
            select: {
              id: true,
              conversationId: true,
              createdAt: true,
              senderId: true,
              type: true,
              payload: true,
              sender: {
                select: {
                  id: true,
                  displayName: true,
                  username: true,
                  accountStatus: true,
                  deletedAt: true,
                },
              },
            },
          })
        : [];

    const lastMsgMap = new Map<string, any>();
    recentMessages.forEach((msg) => {
      const payload = (msg.payload as any) || {};
      let text = payload.text || '';
      if (!text) {
        const mType = (payload.mediaType || msg.type || '').toLowerCase();
        if (mType.includes('image') || mType.includes('photo')) text = 'Photo';
        else if (mType.includes('video')) text = 'Video';
        else if (mType.includes('audio') || mType.includes('voice'))
          text = 'Audio';
        else if (payload.mediaUrl) text = 'Attachment';
      }
      lastMsgMap.set(msg.conversationId, {
        createdAt: msg.createdAt,
        senderId: msg.senderId,
        senderName: msg.sender
          ? presentUserName(msg.sender as any)
          : 'Member',
        type: msg.type ? msg.type.toLowerCase() : 'chat',
        text,
        mediaUrl: payload.mediaUrl || null,
        mediaType: payload.mediaType || null,
      });
    });

    // Use the persisted unreadCount column (maintained by sendMessage/markAsRead),
    // exactly like the /api/messages path — instead of one COUNT query per
    // conversation (the previous N+1).
    const unreadMap = new Map<string, number>();
    participants.forEach((part) => {
      unreadMap.set(part.conversation.id, (part as any).unreadCount || 0);
    });

    const otherUsersMap = new Map<string, any>();
    participants.forEach((p) => {
      const otherP = p.conversation.participants.find(
        (pt) => pt.userId !== userId,
      );
      if (otherP?.user) {
        otherUsersMap.set(otherP.user.id, otherP.user);
      }
    });

    const userIdsToFetchPresence = Array.from(otherUsersMap.keys());
    const presenceMap = new Map<
      string,
      { isOnline: boolean; lastActive: string | null }
    >();
    if (userIdsToFetchPresence.length > 0) {
      const batchPresence = await this.presenceService.getPresenceMany(
        userIdsToFetchPresence,
      );
      // One viewer-settings read + at most two batched follow queries, replacing
      // the previous per-user checkPresenceVisibility N+1.
      const visTargets = userIdsToFetchPresence.map((uId) => {
        const u = otherUsersMap.get(uId);
        return {
          userId: uId,
          rule: u?.settings?.whoCanSeeOnline || 'everyone',
          isEnabled: u?.settings?.showOnlineStatus !== false,
        };
      });
      const visibleSet = await resolvePresenceVisibilityForViewer(
        userId,
        visTargets,
        this.prisma,
        this.blocksService,
      );
      userIdsToFetchPresence.forEach((uId) => {
        const presence = batchPresence.get(uId);
        presenceMap.set(uId, {
          isOnline: visibleSet.has(uId) ? presence?.status === 'online' : false,
          lastActive: presence?.lastSeen || null,
        });
      });
    }

    // Mutual set minus the ones this user placed leaves the ones placed on them.
    const [mutualBlockIds, blockedByMeIds] = await Promise.all([
      this.blocksService.getExcludedUserIds(userId),
      this.blocksService.getBlockedByUserIds(userId),
    ]);
    const blockedByMeSet = new Set(blockedByMeIds);
    const blockedByThemSet = new Set(
      mutualBlockIds.filter((id) => !blockedByMeSet.has(id)),
    );

    const enforcingVerification =
      this.verificationAccess.isEnforcementEnabled();
    const viewerEligible = !enforcingVerification
      ? true
      : await this.verificationAccess.isUserEligible(userId);

    const results = await Promise.all(
      participants.map(async (p) => {
        const conv = p.conversation;
        const allParticipants = conv.participants || [];
        const otherParticipantObj = allParticipants.find(
          (part) => part.userId !== userId,
        );
        const otherUser = otherParticipantObj?.user;

        const lastMsgInfo = lastMsgMap.get(conv.id);

        // DM Visibility Lifecycle (PENDING vs ACTIVE):
        // A conversation with 0 messages MUST NOT appear in the conversation list
        // for ANY user until the first message is sent.
        //
        // The old `|| conv.isInstantMatch` exemption is gone: Instant Match
        // chats now live on their own conversation type and are excluded by the
        // `type: 'DM'` filter on the query above, so an exemption here could
        // only ever re-admit one.
        if (!lastMsgInfo) {
          return null;
        }

        // The last message is read from the shared Message table, but Clear and
        // Delete are per-user watermarks. Without this guard a user who cleared
        // the chat still saw the other person's last message quoted in their
        // list row — content they can no longer open anywhere. The row itself
        // stays (that is what separates Clear from Delete); only the preview goes.
        const cutoff = (p as any).clearedAt as Date | null;
        const previewCleared = Boolean(
          cutoff &&
          lastMsgInfo?.createdAt &&
          new Date(lastMsgInfo.createdAt) <= new Date(cutoff),
        );

        const userPresence = otherUser ? presenceMap.get(otherUser.id) : null;
        const unreadCount = unreadMap.get(conv.id) || 0;

        let canSeeOnline = false;
        let blockStatus = {
          isBlocked: false,
          isBlockedByMe: false,
          isBlockedByThem: false,
        };

        if (otherUser) {
          canSeeOnline = Boolean(
            userPresence?.isOnline &&
            otherUser.settings?.showOnlineStatus !== false,
          );
          const isBlockedByMe = blockedByMeSet.has(otherUser.id);
          const isBlockedByThem = blockedByThemSet.has(otherUser.id);
          blockStatus = {
            isBlocked: isBlockedByMe || isBlockedByThem,
            isBlockedByMe,
            isBlockedByThem,
          };
          if (isBlockedByThem) {
            canSeeOnline = false;
          }
        }

        const pubId = (conv as any).publicId || conv.id;

        // One decision, used for the row title, the avatar, the composer and
        // the target-user block below, so those four can never disagree about
        // whether this person still exists.
        const targetUnavailable = otherUser
          ? isUnavailableUser(otherUser as any)
          : false;

        return {
          id: pubId,
          publicId: pubId,
          internalId: conv.id,
          type: 'DM' as const,
          isMember: (p as any).leftAt == null,
          ownerId: conv.ownerId || null,
          // `conv.name` and `conv.avatarKey` are null on a DM (they are group
          // fields), so the partner's own values are what actually render —
          // which is exactly why they have to go through the presenter.
          name: conv.name || presentUserName(otherUser as any) || 'Chat',
          avatar:
            conv.avatarKey || presentUserAvatar(otherUser as any) || null,
          description: conv.description || null,
          status: conv.status || 'ACTIVE',
          isInstantMatch: conv.isInstantMatch || false,
          expiresAt: conv.expiresAt || null,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          pinned: p.isPinned || false,
          pinnedAt: p.pinnedAt || null,
          muted: p.isMuted || false,
          // `blocked` is the mutual answer: the thread is closed for writes if
          // EITHER side blocked. The two directional flags below tell the client
          // which of the two neutral messages to render — they must never be
          // collapsed into one, and `isBlockedByThem` must never be hardcoded:
          // doing so left the blocked user with a working-looking input.
          blocked: blockStatus.isBlockedByMe || blockStatus.isBlockedByThem,
          isBlockedByMe: blockStatus.isBlockedByMe,
          isBlockedByThem: blockStatus.isBlockedByThem,
          unreadCount,
          unread: unreadCount,
          lastMessage:
            lastMsgInfo && !previewCleared
              ? {
                  createdAt: lastMsgInfo.createdAt,
                  senderId: lastMsgInfo.senderId,
                  senderName: lastMsgInfo.senderName,
                  text: lastMsgInfo.text,
                  type: lastMsgInfo.type,
                  mediaUrl: lastMsgInfo.mediaUrl,
                  mediaType: lastMsgInfo.mediaType,
                }
              : null,
          // Mirrors the rule the backend enforces on send: both sides must be
          // eligible for this viewer to be offered a composer.
          canSendMessages:
            !targetUnavailable &&
            viewerEligible &&
            (!enforcingVerification ||
              !otherUser ||
              this.verificationAccess.isEligibleStatus(
                (otherUser as any).verificationStatus,
              )),
          // Distinct from `canSendMessages` on purpose: the client renders a
          // different, specific notice for "this user is no longer available"
          // than for "you are not verified yet".
          targetUserUnavailable: targetUnavailable,
          targetUser: otherUser
            ? {
                id: otherUser.id,
                username: targetUnavailable
                  ? DELETED_USER_USERNAME
                  : otherUser.username,
                displayName: presentUserName(otherUser as any),
                avatar: presentUserAvatar(otherUser as any),
                isDeleted: targetUnavailable,
                // No profile page should resolve for a deleted account, so the
                // client renders the name as text rather than a link.
                profileAvailable: !targetUnavailable,
                verificationStatus: targetUnavailable
                  ? 'UNVERIFIED'
                  : (otherUser as any).verificationStatus,
                // A deleted account is never shown as online, whatever a stale
                // presence key happens to say.
                isOnline: targetUnavailable
                  ? false
                  : canSeeOnline
                    ? userPresence?.isOnline || false
                    : false,
                lastActive: targetUnavailable
                  ? null
                  : userPresence?.lastActive || null,
              }
            : null,
        };
      }),
    );

    return results.filter(Boolean);
  }

  /**
   * The existing DM between these two users, or null.
   *
   * "Existing" has to mean "one the caller can actually open". The caller's own
   * participant row must still be live: `deletedAt` is set when they delete the
   * conversation and `leftAt` when they leave it, and in both cases the
   * Conversation row and both participant rows survive.
   *
   * Without that filter this returned the id of a conversation the caller had
   * deleted. The client navigated there, the conversations list did not contain
   * it and the history endpoint refused it, and the user got "This conversation
   * doesn't exist or you no longer have access to it" from a Message button
   * that should just have opened a fresh thread. It looked intermittent because
   * it only happened with people whose DM had been deleted at some point.
   *
   * Returning null sends the caller down the draft path instead, which revives
   * the conversation on the first message — and, because deletion also stamps
   * `clearedAt`, revives it empty rather than restoring the old messages.
   *
   * The *target's* row is deliberately not filtered: whether they deleted their
   * copy is their business and has no bearing on the caller opening theirs.
   */
  async lookupExistingDM(currentUserId: string, targetUserId: string) {
    if (!targetUserId || targetUserId === currentUserId) return null;
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DM',
        AND: [
          {
            participants: {
              some: { userId: currentUserId, deletedAt: null, leftAt: null },
            },
          },
          { participants: { some: { userId: targetUserId } } },
        ],
      },
      select: { id: true, publicId: true },
    });
    if (!existing) return null;
    const pubId = existing.publicId || existing.id;
    return { id: pubId, publicId: pubId };
  }

  async startDM(currentUserId: string, targetUserId: string) {
    if (!targetUserId || targetUserId === currentUserId) {
      throw new ForbiddenException('Cannot start a DM with yourself');
    }

    if (await this.blocksService.isBlocked(currentUserId, targetUserId)) {
      throw new ForbiddenException(
        'Cannot start a conversation with a blocked user',
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          type: 'DM',
          AND: [
            { participants: { some: { userId: currentUserId } } },
            { participants: { some: { userId: targetUserId } } },
          ],
        },
      });

      if (existing) {
        await tx.conversationParticipant
          .updateMany({
            where: { conversationId: existing.id, userId: currentUserId },
            data: { deletedAt: null },
          })
          .catch(() => {});

        const pubId = (existing as any).publicId || existing.id;
        return { id: pubId, publicId: pubId };
      }

      // Both people must currently be eligible before a DM row is created.
      // Reviving an existing thread above is untouched — history stays
      // reachable — but a first contact with an ineligible account writes
      // nothing, so the Message button cannot leave orphan conversations.
      await this.verificationAccess.assertUsersEligible(
        [currentUserId, targetUserId],
        currentUserId,
      );

      const newPubId = generatePublicId();
      const conv = await tx.conversation.create({
        data: {
          publicId: newPubId,
          type: 'DM',
          ownerId: currentUserId,
          participants: {
            create: [
              { userId: currentUserId, role: 'OWNER' },
              { userId: targetUserId, role: 'MEMBER' },
            ],
          },
        },
      });

      return { id: newPubId, publicId: newPubId };
    });
  }

  async createInstantMatchDM(
    userAId: string,
    userBId: string,
    activity: string,
  ) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Mirrors MessagesService.createInstantMatchConversation: an expired
    // instant-match DM must not be handed back, since the cleanup job is
    // about to delete it out from under the newly matched pair.
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DM',
        isInstantMatch: true,
        expiresAt: { gt: new Date() },
        AND: [
          { participants: { some: { userId: userAId } } },
          { participants: { some: { userId: userBId } } },
        ],
      },
    });

    if (existing) {
      const pubId = (existing as any).publicId || existing.id;
      return { id: pubId, internalId: existing.id };
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

    return { id: newPubId, internalId: conv.id };
  }
}
