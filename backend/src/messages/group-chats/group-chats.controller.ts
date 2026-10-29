import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { GroupChatsService } from './group-chats.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { VerifiedOnly } from '../../common/decorators/verified-only.decorator';
import { DomainEventService } from '../../events/domain-event.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationFactory } from '../../notifications/notification.factory';
import { SendMessageDto } from '../core/dto/send-message.dto';
import { detach } from '../../common/utils/detach.util';
import { UpdateGroupSettingsDto } from '../dto/update-group-settings.dto';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { announceUnsent } from '../unsend-announce.util';
import { settingsChangeLines } from '../group-settings-announce.util';
import { emitMessageNew, publicMessage } from '../message-alert.util';
import {
  announceJoinRequested,
  announceJoined,
  announceRequestApproved,
  announceRequestDeclined,
  GroupAnnouncer,
} from '../group-join-announce.util';
import { previewOf } from '../core/message-preview';
import {
  announceDeparture,
  type DepartureAnnouncer,
} from '../group-departure-announce.util';
import { JoinGroupDto } from '../core/dto/join-group.dto';
import { inviteRefFromQuery } from '../core/group-invite-access';
import { PushDispatcherService } from '../../push/push-dispatcher.service';

@Controller('api/group-chats')
export class GroupChatsController {
  constructor(
    private readonly groupChatsService: GroupChatsService,
    private readonly domainEventService: DomainEventService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    // Optional so a build without push (and tests) construct without it.
    @Optional() private readonly pushDispatcher?: PushDispatcherService,
  ) {}

  @Get()
  @UseGuards(JwtGuard)
  async getConversations(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.groupChatsService.getUserGroupConversations(
      userId,
      limitNum,
      offsetNum,
    );
  }

  @Post()
  @Idempotent()
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async createGroup(
    @Req() req: AuthenticatedRequest,
    @Body('name') name: string,
    @Body('userIds') userIds: string[],
  ) {
    const userId = req.user?.id;
    if (!name) {
      throw new BadRequestException('Group name is required');
    }
    const targetUserIds = Array.isArray(userIds) ? userIds : [];
    const res = await this.groupChatsService.createGroup(
      targetUserIds,
      userId,
      name,
    );

    // Notify all participants (including creator) so their conversation list
    // updates via socket without relying on fragile optimistic temp-entry patching.
    const allParticipants = [
      ...new Set([
        userId,
        ...targetUserIds.filter((id) => id && id !== userId),
      ]),
    ];
    const others = allParticipants.filter((id) => id !== userId);

    if (others.length > 0) {
      void this.domainEventService.emit(
        'group:member_added',
        { conversationId: res.id, userId },
        others,
      );
    }
    // Emit full conversation payload to ALL participants so each client can
    // inject the real group into their conversation list immediately.
    void this.domainEventService.emit(
      'conversation:updated',
      {
        conversationId: res.id,
        publicId: res.publicId,
        internalId: res.internalId,
        name: res.name,
        type: res.type,
        isGroup: true,
        ownerId: res.ownerId,
        status: res.status,
        createdAt: res.createdAt,
        updatedAt: res.updatedAt,
        avatar: null,
        isNewGroup: true,
      },
      allParticipants,
    );

    return res;
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  async getHistory(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Query('before') beforeCursor?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.groupChatsService.getConversationHistory(
      conversationId,
      userId,
      beforeCursor,
      limitNum,
    );
  }

  @Get(':id/details')
  @UseGuards(JwtGuard)
  async getGroupDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.getGroupDetails(conversationId, userId);
  }

  @Post(':id/messages')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: SendMessageDto,
  ) {
    const userId = req.user?.id;
    const message = await this.groupChatsService.sendMessage(
      userId,
      conversationId,
      body,
    );

    const unblockedParticipantIds = message.recipientIds || [];
    const unmutedRecipientIds = message.unmutedRecipientIds || [];

    const allParticipantIds = Array.from(
      new Set([userId, ...unblockedParticipantIds]),
    );

    // Split by mute: each copy says whether that recipient may be alerted
    // (message-alert.util.ts). This route sent one copy with no flag, so a
    // device without the chat in its list yet raised a banner for a group
    // its user had muted.
    void emitMessageNew(this.domainEventService, message, {
      recipientIds: unblockedParticipantIds,
      unmutedRecipientIds,
      senderId: userId,
    });
    void this.domainEventService.emit(
      'conversation:updated',
      {
        conversationId: message.conversationId,
        publicId: message.publicId,
        internalId: message.internalId,
        lastMessage: {
          id: message.id,
          text: previewOf(message),
          createdAt: message.createdAt,
          senderId: userId,
        },
      },
      allParticipantIds,
    );

    setImmediate(() => {
      for (const pId of unmutedRecipientIds) {
        this.notificationsService
          .createNotification(
            this.notificationFactory.createMessage(
              {
                id: userId,
                displayName: message.senderName,
                avatar: message.senderAvatar,
              },
              {
                id: conversationId,
                name: message.conversationName || message.senderName,
              },
              pId,
              message.text,
            ),
          )
          .catch(() => {});
      }
    });

    void this.domainEventService.emit('message:new', message, [userId]);

    return publicMessage(message);
  }

  @Post(':id/read')
  @UseGuards(JwtGuard)
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.markAsRead(conversationId, userId);
  }

  @Patch(':id/mute')
  @UseGuards(JwtGuard)
  async muteConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('muted') muted: boolean,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.muteConversation(
      conversationId,
      userId,
      muted,
    );
  }

  @Patch(':id/pin')
  @UseGuards(JwtGuard)
  async pinConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('pinned') pinned: boolean,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.pinConversation(
      conversationId,
      userId,
      pinned,
    );
  }

  @Post(':id/clear')
  @UseGuards(JwtGuard)
  async clearChat(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.clearChatForUser(conversationId, userId);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async deleteConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.deleteConversationForUser(
      conversationId,
      userId,
    );
  }

  /** A system line for each setting that actually changed, after the reply. */
  private announceSettingsChange(
    actorId: string,
    internalId: string,
    before: {
      whoCanJoin?: string | null;
      editGroupPermission?: string | null;
    } | null,
    after: { whoCanJoin?: string; editGroupPermission?: string },
  ): void {
    setImmediate(() =>
      detach('group settings line', async () => {
        const handle = await this.groupChatsService.getUserHandle(actorId);
        for (const text of settingsChangeLines(handle, before, after)) {
          await this.broadcastSystemMessage(internalId, actorId, text);
        }
      }),
    );
  }

  /** What the join and request announcements need from this controller. */
  private get departures(): DepartureAnnouncer {
    return {
      events: this.domainEventService,
      participantIds: (id) =>
        this.groupChatsService.getConversationParticipantIds(id),
      userHandle: (id) => this.groupChatsService.getUserHandle(id),
      systemLine: (id, actorId, text, options) =>
        this.groupChatsService.createSystemMessage(id, actorId, text, options),
    };
  }

  private get announcer(): GroupAnnouncer {
    return {
      events: this.domainEventService,
      push: this.pushDispatcher,
      participantIds: (id) =>
        this.groupChatsService.getConversationParticipantIds(id),
      reviewerIds: (id) => this.groupChatsService.getGroupReviewerIds(id),
      userHandle: (id) => this.groupChatsService.getUserHandle(id),
      systemLine: (id, actorId, text) =>
        this.broadcastSystemMessage(id, actorId, text),
    };
  }

  private async broadcastSystemMessage(
    conversationId: string,
    senderId: string,
    text: string,
  ) {
    try {
      const message = await this.groupChatsService.createSystemMessage(
        conversationId,
        senderId,
        text,
      );
      const participantIds =
        await this.groupChatsService.getConversationParticipantIds(
          conversationId,
        );
      void this.domainEventService.emit('message:new', message, participantIds);
      return message;
    } catch {
      // ignore
    }
  }

  @Patch(':id/info')
  @UseGuards(JwtGuard)
  async updateGroupInfo(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      avatarKey?: string;
      avatar?: string;
    },
  ) {
    const userId = req.user?.id;
    const { updated, convBefore, actorHandle, participantIds } =
      await this.groupChatsService.updateGroupInfo(
        conversationId,
        userId,
        body,
      );

    const newAvatar =
      body.avatarKey !== undefined ? body.avatarKey : body.avatar;
    const avatarChanged =
      newAvatar !== undefined && newAvatar !== (convBefore?.avatarKey || null);
    const nameChanged =
      body.name !== undefined && body.name !== (convBefore?.name || null);
    const descChanged =
      body.description !== undefined &&
      body.description !== (convBefore?.description || null);

    let text = '';
    if (avatarChanged && nameChanged)
      text = `${actorHandle} updated group avatar and name`;
    else if (avatarChanged) text = `${actorHandle} changed group avatar`;
    else if (nameChanged)
      text = `${actorHandle} changed group name to "${body.name}"`;
    else if (descChanged) text = `${actorHandle} updated group description`;
    else if (body.name || body.avatarKey || body.avatar || body.description)
      text = `${actorHandle} updated group details`;

    setImmediate(() =>
      detach('group details update fan-out', async () => {
        let systemMsg = null;
        if (text) {
          systemMsg = await this.groupChatsService
            .createSystemMessage(conversationId, userId, text)
            .catch(() => null);
          if (systemMsg) {
            void this.domainEventService.emit(
              'message:new',
              systemMsg,
              participantIds,
            );
          }
        }
        const pubId = updated.publicId || updated.id;
        // `updated` is a full Conversation row, so avatarKey is always present
        // (string or null); the fallbacks that followed could never run.
        const avatarVal = updated.avatarKey;

        const payload = {
          conversationId: pubId,
          id: pubId,
          publicId: pubId,
          internalId: updated.id,
          name: updated.name,
          avatar: avatarVal,
          avatarKey: avatarVal,
          description: updated.description,
          ...(systemMsg
            ? {
                lastMessage: {
                  id: systemMsg.id,
                  text: systemMsg.text,
                  createdAt: systemMsg.createdAt,
                  senderId: userId,
                },
              }
            : {}),
        };

        void this.domainEventService.emit(
          'conversation:updated',
          payload,
          participantIds,
        );
      }),
    );

    return {
      ...updated,
      avatar: updated.avatarKey || null,
    };
  }

  @Post(':id/members')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async addMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('userId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.addGroupMember(
      conversationId,
      userId,
      targetUserId,
    );
    // Already in the group: nothing changed, so nothing to announce.
    if (result.alreadyMember) return result;
    setImmediate(() =>
      detach('group member added fan-out', async () => {
        const memberIds =
          await this.groupChatsService.getConversationParticipantIds(
            conversationId,
          );
        // The membership first, to everyone it concerns: the person added
        // (their sockets join the room, their list gains the group) and the
        // members already there (their member list and count).
        void this.domainEventService.emit(
          'group:member_added',
          {
            conversationId,
            internalId: result.internalId,
            userId: targetUserId,
            addedBy: userId,
            membershipChangedAt: result.joinedAt,
          },
          [...new Set([targetUserId, ...memberIds])],
        );
        void this.domainEventService.emit(
          'conversation:updated',
          { conversationId },
          [targetUserId],
        );
        const [actorHandle, targetHandle] = await Promise.all([
          this.groupChatsService.getUserHandle(userId),
          this.groupChatsService.getUserHandle(targetUserId),
        ]);
        await this.broadcastSystemMessage(
          conversationId,
          userId,
          `${actorHandle} added ${targetHandle} to the group`,
        );
      }),
    );
    return result;
  }

  @Delete(':id/members/:targetUserId')
  @UseGuards(JwtGuard)
  async removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.removeGroupMember(
      conversationId,
      userId,
      targetUserId,
    );
    // A repeated request: already out, already announced.
    if (!result.changed) return result;

    // The removed member hears about it on their devices even with the app
    // closed (re-checked at send time: a re-add before then cancels it).
    // Removal only: someone who leaves knows.
    this.pushDispatcher?.enqueueForGroupRemoval({
      recipientId: targetUserId,
      conversationId: result.internalId,
      removedAt: result.leftAt,
    });

    announceDeparture(this.departures, result, {
      actorId: userId,
      targetUserId,
    });

    return result;
  }

  @Post(':id/leave')
  @UseGuards(JwtGuard)
  async leaveGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.leaveGroup(
      conversationId,
      userId,
    );
    // Already gone: a double tap must not post "X left the group" twice.
    if (!result.changed || !result.internalId || !result.leftAt) return result;

    const departed = {
      internalId: result.internalId,
      publicId: result.publicId || result.internalId,
      leftAt: result.leftAt,
    };
    announceDeparture(this.departures, departed, {
      actorId: userId,
      targetUserId: userId,
    });

    return result;
  }

  @Patch(':id/settings')
  @UseGuards(JwtGuard)
  async updateSettings(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: UpdateGroupSettingsDto,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.updateGroupSettings(
      conversationId,
      userId,
      body,
    );
    this.announceSettingsChange(userId, result.conversationId, result.before, {
      whoCanJoin: body.whoCanJoin,
    });

    setImmediate(() => {
      try {
        const { updatedConv, participantIds } = result;
        if (participantIds && participantIds.length > 0) {
          void this.domainEventService.emit(
            'conversation:updated',
            {
              conversationId:
                updatedConv?.publicId || updatedConv?.id || conversationId,
              whoCanJoin: updatedConv?.whoCanJoin,
              visibility: updatedConv?.visibility,
              allowSharing: updatedConv?.allowSharing,
              editGroupPermission: updatedConv?.editGroupPermission,
            },
            participantIds,
          );
        }
      } catch {
        // The update itself is committed. A realtime broadcast that fails leaves clients to catch up on their next fetch.
      }
    });

    return { success: true, conversationId: result.conversationId };
  }

  @Patch(':id/permissions')
  @UseGuards(JwtGuard)
  async updatePermissions(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('permission') permission: string,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.updateGroupEditPermission(
      conversationId,
      userId,
      permission,
    );
    this.announceSettingsChange(userId, result.conversationId, result.before, {
      editGroupPermission: permission,
    });

    setImmediate(() => {
      try {
        const { updatedConv, participantIds } = result;
        if (participantIds && participantIds.length > 0) {
          void this.domainEventService.emit(
            'conversation:updated',
            {
              conversationId:
                updatedConv?.publicId || updatedConv?.id || conversationId,
              editGroupPermission: permission,
            },
            participantIds,
          );
        }
      } catch {
        // The update itself is committed. A realtime broadcast that fails leaves clients to catch up on their next fetch.
      }
    });

    return { success: true };
  }

  @Post(':id/owner')
  @UseGuards(JwtGuard)
  async changeOwner(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const targetHandle =
      await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.changeGroupOwner(
      conversationId,
      userId,
      targetUserId,
    );
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});
    const actorHandle = await this.groupChatsService.getUserHandle(userId);

    const participantIds =
      await this.groupChatsService.getConversationParticipantIds(
        conversationId,
      );
    if (participantIds.length > 0) {
      void this.domainEventService.emit(
        'conversation:updated',
        {
          conversationId,
          ownerId: targetUserId,
        },
        participantIds,
      );
      void this.domainEventService.emit(
        'group:role_changed',
        {
          conversationId,
          targetUserId,
          newRole: 'OWNER',
        },
        participantIds,
      );
      void this.domainEventService.emit(
        'group:role_changed',
        {
          conversationId,
          targetUserId: userId,
          newRole: 'ADMIN', // Former owner becomes admin usually, or member. We can just force a refetch on the frontend.
        },
        participantIds,
      );
    }

    await this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} transferred group ownership to ${targetHandle}`,
    );
    return result;
  }

  @Post(':id/admins')
  @UseGuards(JwtGuard)
  async promoteAdmin(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const targetHandle =
      await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.promoteToAdmin(
      conversationId,
      userId,
      targetUserId,
    );
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    const participantIds =
      await this.groupChatsService.getConversationParticipantIds(
        conversationId,
      );
    if (participantIds.length > 0) {
      void this.domainEventService.emit(
        'group:role_changed',
        {
          conversationId,
          targetUserId,
          newRole: 'ADMIN',
        },
        participantIds,
      );
    }
    await this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} promoted ${targetHandle} to Admin`,
    );
    return result;
  }

  @Delete(':id/admins/:targetUserId')
  @UseGuards(JwtGuard)
  async demoteAdmin(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const targetHandle =
      await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.demoteFromAdmin(
      conversationId,
      userId,
      targetUserId,
    );
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    const participantIds =
      await this.groupChatsService.getConversationParticipantIds(
        conversationId,
      );
    if (participantIds.length > 0) {
      void this.domainEventService.emit(
        'group:role_changed',
        {
          conversationId,
          targetUserId,
          newRole: 'MEMBER',
        },
        participantIds,
      );
    }
    await this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} demoted ${targetHandle} to Member`,
    );
    return result;
  }

  @Post(':id/end')
  @UseGuards(JwtGuard)
  async endGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    // endGroup verifies ownership; announce only after it succeeds.
    const result = await this.groupChatsService.endGroup(
      conversationId,
      userId,
    );
    await this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} closed the group`,
    );
    return result;
  }

  @Post(':id/requests/:targetUserId/accept')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async acceptJoinRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    // The service also drops every affected cache before it returns.
    const result = await this.groupChatsService.acceptGroupJoinRequest(
      conversationId,
      userId,
      targetUserId,
    );
    // An approval that already happened (another admin, a double tap).
    if (result.changed) {
      announceRequestApproved(this.announcer, result, userId, targetUserId);
    }
    return result;
  }

  @Post(':id/requests/:targetUserId/decline')
  @UseGuards(JwtGuard)
  async declineJoinRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.declineGroupJoinRequest(
      conversationId,
      userId,
      targetUserId,
    );
    if (result.changed)
      announceRequestDeclined(this.announcer, result, targetUserId);
    return result;
  }

  /**
   * The group's recent requests to join, for its owner and admins only (the
   * service refuses anyone else). Never a message: see getJoinRequestActivity.
   */
  @Get(':id/join-requests/activity')
  @UseGuards(JwtGuard)
  async getJoinRequestActivity(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.groupChatsService.getJoinRequestActivity(
      conversationId,
      req.user?.id,
    );
  }

  /** A member's invite link for the group (an existing one while it lasts). */
  @Post(':id/invite-links')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async createInviteLink(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.groupChatsService.createInviteLink(
      conversationId,
      req.user?.id,
    );
  }

  /** Revokes every invite link the group has; owner and admins only. */
  @Post(':id/invite-links/reset')
  @UseGuards(JwtGuard)
  async resetInviteLinks(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.groupChatsService.resetInviteLinks(
      conversationId,
      req.user?.id,
    );
  }

  // Readable by any authenticated user, member or not — an invite is a dead
  // end otherwise, since /details and the history endpoint both require
  // membership. `code` or `messageId` names the invite the viewer came
  // through; what it discloses depends on that invite (getGroupInvitePreview).
  @Get(':id/invite')
  @UseGuards(JwtGuard)
  async getInvitePreview(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Query('code') code?: string,
    @Query('messageId') messageId?: string,
  ) {
    return this.groupChatsService.getGroupInvitePreview(
      conversationId,
      req.user?.id,
      inviteRefFromQuery(code, messageId),
    );
  }

  @Post(':id/join')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async joinGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: JoinGroupDto = {},
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.joinGroupByInvite(
      conversationId,
      userId,
      { code: body?.code, messageId: body?.messageId },
    );

    // A re-tapped request renews it without telling the admins again.
    if (result.status === 'PENDING') {
      if (result.newRequest)
        announceJoinRequested(this.announcer, result, userId);
      return result;
    }
    // Only a membership that did NOT already exist announces itself. Without
    // this guard a re-tapped invite posts "x joined the group" over and over.
    if (result.alreadyMember) return result;

    // Before replying: the joiner's client refetches its conversation list the
    // moment this answers, and a list cached from before the join would hide
    // the group it has just joined.
    await this.groupChatsService
      .evictMembershipCaches(result.internalId, [userId])
      .catch(() => {});
    announceJoined(this.announcer, result, userId);
    return result;
  }

  // Same handler as /join. Kept because the invite card has always posted here.
  @Post(':id/request')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async requestJoin(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: JoinGroupDto = {},
  ) {
    return this.joinGroup(req, conversationId, body);
  }

  @Delete('msg/:messageId/for-me')
  @UseGuards(JwtGuard)
  async deleteMessageForMe(
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.deleteMessageForMe(messageId, userId);
  }

  @Delete('msg/:messageId')
  @UseGuards(JwtGuard)
  async unsendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.unsendMessage(
      messageId,
      userId,
    );
    // Only a change is announced: unsending twice is answered with success
    // (`changed: false`) and must not send every device the event again.
    announceUnsent(this.domainEventService, result);
    return result;
  }

  @Post('msg/:messageId/forward')
  @UseGuards(JwtGuard)
  async forwardMessage(
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
    @Body('targetConversationIds') targetConversationIds: string[],
  ) {
    const userId = req.user?.id;
    if (
      !Array.isArray(targetConversationIds) ||
      targetConversationIds.length === 0
    ) {
      throw new BadRequestException('targetConversationIds array is required');
    }
    const result = await this.groupChatsService.forwardMessage(
      messageId,
      targetConversationIds,
      userId,
    );

    if (result.messages && Array.isArray(result.messages)) {
      for (const message of result.messages) {
        const conversationId = message.conversationId;

        // Batch block+mute check — replaces N+1 per-participant loop
        const [
          { recipientIds: unblockedParticipantIds, unmutedRecipientIds },
          conv,
        ] = await Promise.all([
          this.groupChatsService.getBatchUnblockedAndUnmutedParticipants(
            conversationId,
            userId,
          ),
          this.groupChatsService.getConversationById(conversationId),
        ]);

        void this.domainEventService.emit(
          'message:new',
          message,
          unblockedParticipantIds,
        );
        void this.domainEventService.emit(
          'conversation:updated',
          {
            conversationId: message.conversationId,
            publicId: message.publicId,
            internalId: message.internalId,
            lastMessage: {
              id: message.id,
              text: previewOf(message),
              createdAt: message.createdAt,
              senderId: userId,
            },
          },
          unblockedParticipantIds,
        );

        for (const pId of unmutedRecipientIds) {
          this.notificationsService
            .createNotification(
              this.notificationFactory.createMessage(
                {
                  id: userId,
                  displayName: message.senderName,
                  avatar: message.senderAvatar,
                },
                conv || { id: conversationId, name: message.senderName },
                pId,
                message.text || 'Forwarded a message',
              ),
            )
            .catch(() => {});
        }
        void this.domainEventService.emit('message:new', message, [userId]);
      }
    }

    return result;
  }

  @Post(':id/react')
  @UseGuards(JwtGuard)
  async reactToMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') messageId: string,
    @Body('reaction') reaction: string,
  ) {
    const userId = req.user?.id;
    return this.groupChatsService.reactToMessage(messageId, userId, reaction);
  }
}
