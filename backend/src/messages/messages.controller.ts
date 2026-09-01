import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  Delete,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { MessagesService } from './messages.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import { DomainEventService } from '../events/domain-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { SendMessageDto } from './core/dto/send-message.dto';
import { emitMessageNew } from './message-alert.util';

@Controller('api/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly domainEventService: DomainEventService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
  ) {}

  @Delete('msg/:messageId/for-me')
  @UseGuards(JwtGuard)
  async deleteMessageForMe(
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    const userId = req.user?.id;
    return this.messagesService.deleteMessageForMe(messageId, userId);
  }

  @Delete('msg/:messageId')
  @UseGuards(JwtGuard)
  async unsendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.messagesService.unsendMessage(messageId, userId);
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
  @VerifiedOnly()
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
    const result = await this.messagesService.forwardMessage(
      messageId,
      targetConversationIds,
      userId,
    );

    if (result.messages && Array.isArray(result.messages)) {
      for (const message of result.messages) {
        const conversationId = message.conversationId;

        // Batched block+mute resolution — replaces the per-participant
        // isUserBlockedBy / isUserConversationMuted N+1 loops.
        const [
          { recipientIds: unblockedParticipantIds, unmutedRecipientIds },
          conv,
        ] = await Promise.all([
          this.messagesService.getBatchUnblockedAndUnmutedParticipants(
            conversationId,
            userId,
          ),
          this.messagesService.getConversationById(conversationId),
        ]);

        // Emit to others; muted recipients get the message without the alert.
        emitMessageNew(this.domainEventService, message, {
          recipientIds: unblockedParticipantIds,
          unmutedRecipientIds,
        });
        this.domainEventService.emit(
          'conversation:updated',
          {
            conversationId: message.conversationId,
            publicId: message.publicId,
            internalId: message.internalId,
            // Lets clients skip a conversation that has no row in the Messages
            // list at all, instead of reading its absence as a stale cache.
            chatType: message.chatType || 'normal',
            isInstantMatch: Boolean(message.isInstantMatch),
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

        // Notifications (only unmuted recipients)
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

        // Emit to sender (multi-device sync, never alerted)
        this.domainEventService.emit(
          'message:new',
          { ...message, alert: false },
          [userId],
        );
      }
    }

    return result;
  }

  @Get()
  @UseGuards(JwtGuard)
  async getConversations(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user?.id;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const limitNum = isNaN(parsedLimit) ? 20 : parsedLimit;
    const offsetNum = isNaN(parsedOffset) ? 0 : parsedOffset;
    return this.messagesService.getUserConversations(
      userId,
      limitNum,
      offsetNum,
    );
  }

  @Get(':conversationId')
  @UseGuards(JwtGuard)
  async getHistory(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Query('before') beforeCursor?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.messagesService.getConversationHistory(
      conversationId,
      userId,
      beforeCursor,
      limitNum,
    );
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
    const message = await this.messagesService.sendMessage(
      userId,
      conversationId,
      body,
    );

    const unblockedParticipantIds = message.recipientIds || [];
    const unmutedRecipientIds = message.unmutedRecipientIds || [];

    const allParticipantIds = Array.from(
      new Set([userId, ...unblockedParticipantIds]),
    );

    // Emit to others. Muted recipients still receive the message (mute is not
    // a delivery filter) but receive it flagged `alert: false`.
    emitMessageNew(this.domainEventService, message, {
      recipientIds: unblockedParticipantIds,
      unmutedRecipientIds,
    });
    this.domainEventService.emit(
      'conversation:updated',
      {
        conversationId: message.conversationId,
        publicId: message.publicId,
        internalId: message.internalId,
        chatType: message.chatType || 'normal',
        isInstantMatch: Boolean(message.isInstantMatch),
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
              // The type has to travel with the conversation stub. Passing only
              // { id, name } left the factory unable to tell an Instant Match
              // chat from a DM, so every Instant Match message produced a
              // notification that deep-linked into Messages.
              {
                id: conversationId,
                name: message.conversationName || message.senderName,
                type: message.isInstantMatch ? 'INSTANT_MATCH' : undefined,
                isInstantMatch: Boolean(message.isInstantMatch),
              },
              pId,
              message.text,
            ),
          )
          .catch(() => {});
      }
    });

    return message;
  }

  @Post()
  @UseGuards(JwtGuard)
  async startConversation(
    @Req() req: AuthenticatedRequest,
    @Query('userIds') userIdsQuery?: string,
    @Body('userIds') userIdsBody?: string[],
    @Body('name') nameBody?: string,
  ) {
    const userId = req.user?.id;
    let targetUserIds: string[] = [];
    if (userIdsBody) {
      if (Array.isArray(userIdsBody)) {
        targetUserIds = userIdsBody
          .map((item: any) =>
            typeof item === 'string' ? item : item?.id || item?.userId,
          )
          .filter(Boolean);
      } else if (typeof userIdsBody === 'string') {
        targetUserIds = [userIdsBody];
      } else if (typeof userIdsBody === 'object') {
        const singleId = (userIdsBody as any).id || (userIdsBody as any).userId;
        if (singleId) targetUserIds = [singleId];
      }
    } else if (userIdsQuery) {
      targetUserIds = userIdsQuery.split(',');
    }
    const res = await this.messagesService.startConversation(
      targetUserIds,
      userId,
      nameBody,
    );
    if (targetUserIds.length > 0) {
      const others = targetUserIds.filter((tId) => tId && tId !== userId);
      if (others.length > 0) {
        this.domainEventService.emit(
          'group:member_added',
          { conversationId: res.id, userId },
          others,
        );
        this.domainEventService.emit(
          'conversation:updated',
          { conversationId: res.id },
          others,
        );
      }
    }
    return res;
  }

  @Post(':id/react')
  @UseGuards(JwtGuard)
  async reactToMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') messageId: string,
    @Body('reaction') reaction: string,
  ) {
    const userId = req.user?.id;
    return this.messagesService.reactToMessage(messageId, userId, reaction);
  }

  @Post(':id/read')
  @UseGuards(JwtGuard)
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.messagesService.markAsRead(conversationId, userId);
  }

  @Patch(':id/mute')
  @UseGuards(JwtGuard)
  async muteConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('muted') muted: boolean,
  ) {
    const userId = req.user?.id;
    return this.messagesService.muteConversation(conversationId, userId, muted);
  }

  @Patch(':id/pin')
  @UseGuards(JwtGuard)
  async pinConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('pinned') pinned: boolean,
  ) {
    const userId = req.user?.id;
    return this.messagesService.pinConversation(conversationId, userId, pinned);
  }

  @Post(':id/clear')
  @UseGuards(JwtGuard)
  async clearChat(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.messagesService.clearChatForUser(conversationId, userId);
  }

  @Delete(':id/conversations')
  @UseGuards(JwtGuard)
  async deleteConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.messagesService.deleteConversationForUser(
      conversationId,
      userId,
    );
  }

  /**
   * These group-management endpoints mirror `/api/group-chats/*`, which is the
   * canonical path the web client uses. The mirror was emitting the system
   * message but not `group:role_changed`, so a role change made through it
   * reached nobody in real time. Kept in sync here rather than left as a quiet
   * trap for any client still on this route.
   */
  private async emitRoleChanged(
    conversationId: string,
    targetUserId: string,
    newRole: string,
  ) {
    try {
      const participantIds =
        await this.messagesService.getConversationParticipantIds(
          conversationId,
        );
      if (participantIds.length > 0) {
        this.domainEventService.emit(
          'group:role_changed',
          { conversationId, targetUserId, newRole },
          participantIds,
        );
      }
    } catch {
      // Never let a realtime emit fail the mutation that already committed.
    }
  }

  private async broadcastSystemMessage(
    conversationId: string,
    senderId: string,
    text: string,
  ) {
    try {
      const message = await this.messagesService.createSystemMessage(
        conversationId,
        senderId,
        text,
      );
      const participantIds =
        await this.messagesService.getConversationParticipantIds(
          conversationId,
        );
      this.domainEventService.emit('message:new', message, participantIds);
      return message;
    } catch {
      // Ignore background system message errors
    }
  }

  @Patch(':id/group')
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
    const realConvId =
      await this.messagesService.resolveConversationId(conversationId);
    const convBefore =
      await this.messagesService.getConversationById(realConvId);

    const result = await this.messagesService.updateGroupInfo(
      conversationId,
      userId,
      body,
    );
    const actorHandle = await this.messagesService.getUserHandle(userId);

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

    if (text) {
      await this.broadcastSystemMessage(conversationId, userId, text);
    }

    if (result) {
      const pubId = result.publicId || result.id;
      const pIds = await this.messagesService.getConversationParticipantIds(
        result.id,
      );
      const avatarVal = result.avatarKey || result.avatar || null;
      this.domainEventService.emit(
        'conversation:updated',
        {
          conversationId: pubId,
          id: pubId,
          publicId: pubId,
          internalId: result.id,
          name: result.name,
          avatar: avatarVal,
          avatarKey: avatarVal,
          description: result.description,
        },
        pIds,
      );
    }

    return {
      ...result,
      avatar: result.avatarKey || result.avatar || null,
    };
  }

  @Post(':id/members')
  @UseGuards(JwtGuard)
  async addMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('userId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.messagesService.addGroupMember(
      conversationId,
      userId,
      targetUserId,
    );
    const actorHandle = await this.messagesService.getUserHandle(userId);
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
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
    // Mutate FIRST — if removal is rejected (not admin, target is owner, etc.)
    // we must not persist/broadcast an "X removed Y" system message.
    const result = await this.messagesService.removeGroupMember(
      conversationId,
      userId,
      targetUserId,
    );

    const [targetHandle, actorHandle] = await Promise.all([
      this.messagesService.getUserHandle(targetUserId),
      this.messagesService.getUserHandle(userId),
    ]);
    const text = `${actorHandle} removed ${targetHandle} from the group`;
    const message = await this.messagesService.createSystemMessage(
      conversationId,
      userId,
      text,
    );

    this.domainEventService.emit(
      'group:member_removed',
      {
        conversationId,
        targetUserId,
        removedBy: userId,
        message,
      },
      [targetUserId],
    );
    this.domainEventService.emit('message:new', message, [targetUserId]);

    const remainingParticipantIds =
      await this.messagesService.getConversationParticipantIds(conversationId);
    const others = remainingParticipantIds.filter(
      (pId) => pId !== targetUserId,
    );
    if (others.length > 0) {
      this.domainEventService.emit('message:new', message, others);
      this.domainEventService.emit(
        'group:member_removed',
        {
          conversationId,
          targetUserId,
          removedBy: userId,
          message,
        },
        others,
      );
    }

    return result;
  }

  @Post(':id/leave')
  @UseGuards(JwtGuard)
  async leaveGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    // Mutate FIRST so a failed leave never leaves an orphan "X left" message.
    const result = await this.messagesService.leaveGroup(
      conversationId,
      userId,
    );

    const actorHandle = await this.messagesService.getUserHandle(userId);
    const text = `${actorHandle} left the group`;
    const message = await this.messagesService.createSystemMessage(
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

    const remainingParticipantIds =
      await this.messagesService.getConversationParticipantIds(conversationId);
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
    return this.messagesService.updateGroupSettings(
      conversationId,
      userId,
      body,
    );
  }

  @Patch(':id/permissions')
  @UseGuards(JwtGuard)
  async updatePermissions(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('permission') permission: string,
  ) {
    const userId = req.user?.id;
    return this.messagesService.updateGroupEditPermission(
      conversationId,
      userId,
      permission,
    );
  }

  @Post(':id/owner')
  @UseGuards(JwtGuard)
  async changeOwner(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    const result = await this.messagesService.changeGroupOwner(
      conversationId,
      userId,
      targetUserId,
    );
    const actorHandle = await this.messagesService.getUserHandle(userId);

    const participantIds =
      await this.messagesService.getConversationParticipantIds(conversationId);
    if (participantIds.length > 0) {
      this.domainEventService.emit(
        'conversation:updated',
        {
          conversationId,
          ownerId: targetUserId,
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
    const [targetHandle, actorHandle] = await Promise.all([
      this.messagesService.getUserHandle(targetUserId),
      this.messagesService.getUserHandle(userId),
    ]);
    const result = await this.messagesService.promoteToAdmin(
      conversationId,
      userId,
      targetUserId,
    );
    await this.emitRoleChanged(conversationId, targetUserId, 'ADMIN');
    this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} promoted ${targetHandle} to Admin`,
    ).catch(() => {});
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
    const [targetHandle, actorHandle] = await Promise.all([
      this.messagesService.getUserHandle(targetUserId),
      this.messagesService.getUserHandle(userId),
    ]);
    const result = await this.messagesService.demoteFromAdmin(
      conversationId,
      userId,
      targetUserId,
    );
    await this.emitRoleChanged(conversationId, targetUserId, 'MEMBER');
    this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} demoted ${targetHandle} to Member`,
    ).catch(() => {});
    return result;
  }

  @Post(':id/end')
  @UseGuards(JwtGuard)
  async endGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    const actorHandle = await this.messagesService.getUserHandle(userId);
    await this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} closed the group`,
    );
    return this.messagesService.endGroup(conversationId, userId);
  }

  @Post(':id/requests/:targetUserId/accept')
  @UseGuards(JwtGuard)
  async acceptJoinRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    const result = await this.messagesService.acceptGroupJoinRequest(
      conversationId,
      userId,
      targetUserId,
    );
    const actorHandle = await this.messagesService.getUserHandle(userId);
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
  async declineJoinRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    return this.messagesService.declineGroupJoinRequest(
      conversationId,
      userId,
      targetUserId,
    );
  }

  @Post(':id/join')
  @UseGuards(JwtGuard)
  async joinGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.messagesService.joinGroupByInvite(
      conversationId,
      userId,
    );
    if (result.status === 'JOINED' && !result.alreadyMember) {
      const userHandle = await this.messagesService.getUserHandle(userId);
      await this.broadcastSystemMessage(
        conversationId,
        userId,
        `${userHandle} joined the group`,
      );
    }
    return result;
  }

  @Post(':id/request')
  @UseGuards(JwtGuard)
  async requestJoinGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    // Identical semantics to :id/join — the invite card has always posted here.
    return this.joinGroup(req, conversationId);
  }

  @Get(':id/invite')
  @UseGuards(JwtGuard)
  async getInvitePreview(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.messagesService.getGroupInvitePreview(
      conversationId,
      req.user?.id,
    );
  }
}
