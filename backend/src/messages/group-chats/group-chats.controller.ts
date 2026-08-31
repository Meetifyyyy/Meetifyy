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
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { GroupChatsService } from './group-chats.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { VerifiedOnly } from '../../common/decorators/verified-only.decorator';
import { DomainEventService } from '../../events/domain-event.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationFactory } from '../../notifications/notification.factory';
import { SendMessageDto } from '../core/dto/send-message.dto';

@Controller('api/group-chats')
export class GroupChatsController {
  constructor(
    private readonly groupChatsService: GroupChatsService,
    private readonly domainEventService: DomainEventService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
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
      this.domainEventService.emit(
        'group:member_added',
        { conversationId: res.id, userId },
        others,
      );
    }
    // Emit full conversation payload to ALL participants so each client can
    // inject the real group into their conversation list immediately.
    this.domainEventService.emit(
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

    this.domainEventService.emit(
      'message:new',
      message,
      unblockedParticipantIds,
    );
    this.domainEventService.emit(
      'conversation:updated',
      {
        conversationId: message.conversationId,
        publicId: message.publicId,
        internalId: message.internalId,
        lastMessage: {
          text:
            message.text ||
            (message.inviteData
              ? message.inviteData.groupName
                ? `Group invite: ${message.inviteData.groupName}`
                : 'Group invite'
              : ''),
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

    this.domainEventService.emit('message:new', message, [userId]);

    return message;
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
      this.domainEventService.emit('message:new', message, participantIds);
      return message;
    } catch {
      // ignore
    }
  }

  @Patch(':id/info')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
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

    setImmediate(async () => {
      let systemMsg = null;
      if (text) {
        systemMsg = await this.groupChatsService
          .createSystemMessage(conversationId, userId, text)
          .catch(() => null);
        if (systemMsg) {
          this.domainEventService.emit(
            'message:new',
            systemMsg,
            participantIds,
          );
        }
      }
      const pubId = updated.publicId || updated.id;
      const avatarVal =
        updated.avatarKey !== undefined
          ? updated.avatarKey
          : updated.avatar !== undefined
            ? updated.avatar
            : convBefore?.avatarKey || null;

      const payload: any = {
        conversationId: pubId,
        id: pubId,
        publicId: pubId,
        internalId: updated.id,
        name: updated.name,
        avatar: avatarVal,
        avatarKey: avatarVal,
        description: updated.description,
      };

      if (systemMsg) {
        payload.lastMessage = {
          text: systemMsg.text,
          createdAt: systemMsg.createdAt,
          senderId: userId,
        };
      }

      this.domainEventService.emit(
        'conversation:updated',
        payload,
        participantIds,
      );
    });

    return {
      ...updated,
      avatar: updated.avatarKey || updated.avatar || null,
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
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});
    setImmediate(async () => {
      const [actorHandle, targetHandle] = await Promise.all([
        this.groupChatsService.getUserHandle(userId),
        this.groupChatsService.getUserHandle(targetUserId),
      ]);
      await this.broadcastSystemMessage(
        conversationId,
        userId,
        `${actorHandle} added ${targetHandle} to the group`,
      );
      this.domainEventService.emit(
        'group:member_added',
        { conversationId, userId: targetUserId },
        [targetUserId],
      );
      this.domainEventService.emit('conversation:updated', { conversationId }, [
        targetUserId,
      ]);
    });
    return result;
  }

  @Delete(':id/members/:targetUserId')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
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
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});

    setImmediate(async () => {
      const [actorHandle, targetHandle, remainingParticipantIds] =
        await Promise.all([
          this.groupChatsService.getUserHandle(userId),
          this.groupChatsService.getUserHandle(targetUserId),
          this.groupChatsService.getConversationParticipantIds(conversationId),
        ]);
      const text = `${actorHandle} removed ${targetHandle} from the group`;
      const message = await this.groupChatsService.createSystemMessage(
        conversationId,
        userId,
        text,
      );

      this.domainEventService.emit(
        'group:member_removed',
        { conversationId, targetUserId, removedBy: userId, message },
        [targetUserId],
      );
      this.domainEventService.emit('message:new', message, [targetUserId]);

      const others = remainingParticipantIds.filter(
        (pId) => pId !== targetUserId,
      );
      if (others.length > 0) {
        this.domainEventService.emit('message:new', message, others);
        this.domainEventService.emit(
          'group:member_removed',
          { conversationId, targetUserId, removedBy: userId, message },
          others,
        );
      }
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
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});

    setImmediate(async () => {
      const [actorHandle, remainingParticipantIds] = await Promise.all([
        this.groupChatsService.getUserHandle(userId),
        this.groupChatsService.getConversationParticipantIds(conversationId),
      ]);
      const text = `${actorHandle} left the group`;
      const message = await this.groupChatsService.createSystemMessage(
        conversationId,
        userId,
        text,
      );

      this.domainEventService.emit(
        'group:member_removed',
        {
          conversationId,
          targetUserId: userId,
          removedBy: userId,
          message,
        },
        [userId],
      );

      const others = remainingParticipantIds.filter((pId) => pId !== userId);
      if (others.length > 0) {
        this.domainEventService.emit('message:new', message, others);
        this.domainEventService.emit(
          'group:member_removed',
          {
            conversationId,
            targetUserId: userId,
            removedBy: userId,
            message,
          },
          others,
        );
      }
    });

    return result;
  }

  @Patch(':id/settings')
  @UseGuards(JwtGuard)
  async updateSettings(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: any,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.updateGroupSettings(
      conversationId,
      userId,
      body,
    );

    setImmediate(() => {
      try {
        const { updatedConv, participantIds } = result;
        if (participantIds && participantIds.length > 0) {
          this.domainEventService.emit(
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
      } catch {}
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

    setImmediate(() => {
      try {
        const { updatedConv, participantIds } = result;
        if (participantIds && participantIds.length > 0) {
          this.domainEventService.emit(
            'conversation:updated',
            {
              conversationId:
                updatedConv?.publicId || updatedConv?.id || conversationId,
              editGroupPermission: permission,
            },
            participantIds,
          );
        }
      } catch {}
    });

    return { success: true };
  }

  @Post(':id/owner')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
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
      this.domainEventService.emit(
        'conversation:updated',
        {
          conversationId,
          ownerId: targetUserId,
        },
        participantIds,
      );
      this.domainEventService.emit(
        'group:role_changed',
        {
          conversationId,
          targetUserId,
          newRole: 'OWNER',
        },
        participantIds,
      );
      this.domainEventService.emit(
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
  @VerifiedOnly()
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
      this.domainEventService.emit(
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
  @VerifiedOnly()
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
      this.domainEventService.emit(
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
    await this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} closed the group`,
    );
    return this.groupChatsService.endGroup(conversationId, userId);
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
    const targetHandle =
      await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.acceptGroupJoinRequest(
      conversationId,
      userId,
      targetUserId,
    );
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    const text = `${actorHandle} approved ${targetHandle}'s request to join`;
    await this.broadcastSystemMessage(conversationId, userId, text);

    this.domainEventService.emit(
      'group:member_added',
      { conversationId, userId: targetUserId },
      [targetUserId],
    );
    return result;
  }

  @Post(':id/requests/:targetUserId/decline')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
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
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});
    return result;
  }

  // Readable by any authenticated user, member or not — an invite link is a
  // dead end otherwise, since /details and the history endpoint both require
  // membership. Returns only what the invite itself already discloses.
  @Get(':id/invite')
  @UseGuards(JwtGuard)
  async getInvitePreview(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.groupChatsService.getGroupInvitePreview(
      conversationId,
      req.user?.id,
    );
  }

  @Post(':id/join')
  @UseGuards(JwtGuard)
  async joinGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.joinGroupByInvite(
      conversationId,
      userId,
    );
    this.groupChatsService
      .invalidateGroupDetailsCache(conversationId)
      .catch(() => {});

    // Only a membership that did NOT already exist announces itself. Without
    // this guard a re-tapped invite posts "x joined the group" over and over.
    if (result.status === 'JOINED' && !result.alreadyMember) {
      const userHandle = await this.groupChatsService.getUserHandle(userId);
      await this.broadcastSystemMessage(
        conversationId,
        userId,
        `${userHandle} joined the group`,
      );
      try {
        const participantIds =
          await this.groupChatsService.getConversationParticipantIds(
            conversationId,
          );
        // The joiner needs conversation:updated to pull the group into their
        // own chat list; existing members need member_added to refresh rosters.
        this.domainEventService.emit(
          'group:member_added',
          { conversationId: result.conversationId, userId },
          participantIds,
        );
        this.domainEventService.emit(
          'conversation:updated',
          { conversationId: result.conversationId },
          participantIds,
        );
      } catch {
        // Real-time fan-out is best-effort; the join itself already committed.
      }
    }
    return result;
  }

  // Same handler as /join. Kept because the invite card has always posted here.
  @Post(':id/request')
  @UseGuards(JwtGuard)
  async requestJoin(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.joinGroup(req, conversationId);
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
    if (result.success && result.conversationId) {
      const pubId = (result as any).publicId || result.conversationId;
      const participantIds = (result as any).participantIds || [];
      setImmediate(() => {
        this.domainEventService.emit(
          'message:updated',
          {
            id: messageId,
            conversationId: pubId,
            publicId: pubId,
            internalId: result.conversationId,
            state: 'UNSENT',
            text: 'This message was unsent',
            mediaUrl: null,
            mediaType: null,
            inviteData: null,
            replyTo: null,
          },
          participantIds,
        );
        this.domainEventService.emit(
          'conversation:updated',
          {
            conversationId: pubId,
            lastMessageText: 'This message was unsent',
            updatedAt: new Date().toISOString(),
          },
          participantIds,
        );
      });
    }
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

        this.domainEventService.emit(
          'message:new',
          message,
          unblockedParticipantIds,
        );
        this.domainEventService.emit(
          'conversation:updated',
          {
            conversationId: message.conversationId,
            publicId: message.publicId,
            internalId: message.internalId,
            lastMessage: {
              text:
                message.text ||
                (message.mediaUrl
                  ? message.mediaType === 'image'
                    ? 'Photo'
                    : message.mediaType === 'video'
                      ? 'Video'
                      : 'Audio'
                  : ''),
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
        this.domainEventService.emit('message:new', message, [userId]);
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
