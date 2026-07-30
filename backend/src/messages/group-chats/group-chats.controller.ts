import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { GroupChatsService } from './group-chats.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
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
  async getConversations(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.groupChatsService.getUserGroupConversations(userId, limitNum, offsetNum);
  }

  @Post()
  @UseGuards(JwtGuard)
  async createGroup(
    @Req() req: any,
    @Body('name') name: string,
    @Body('userIds') userIds: string[]
  ) {
    const userId = req.user?.id;
    if (!name) {
      throw new BadRequestException('Group name is required');
    }
    const targetUserIds = Array.isArray(userIds) ? userIds : [];
    const res = await this.groupChatsService.createGroup(targetUserIds, userId, name);

    if (targetUserIds.length > 0) {
      const others = targetUserIds.filter(tId => tId && tId !== userId);
      if (others.length > 0) {
        this.domainEventService.emit('group:member_added', { conversationId: res.id, userId }, others);
        this.domainEventService.emit('conversation:updated', { conversationId: res.id }, others);
      }
    }
    return res;
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  async getHistory(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Query('deviceId') deviceId?: string,
    @Query('before') beforeCursor?: string,
    @Query('limit') limit?: string
  ) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.groupChatsService.getConversationHistory(conversationId, userId, deviceId, beforeCursor, limitNum);
  }

  @Post(':id/messages')
  @UseGuards(JwtGuard)
  async sendMessage(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: SendMessageDto
  ) {
    const userId = req.user?.id;
    const message = await this.groupChatsService.sendMessage(userId, conversationId, body);
    const conv = await this.groupChatsService.getConversationById(conversationId);

    const participantIds = await this.groupChatsService.getConversationParticipantIds(conversationId);
    const otherParticipantIds = participantIds.filter(pId => pId !== userId);
    const unblockedParticipantIds = [];
    for (const pId of otherParticipantIds) {
      const hasBlockedSender = await this.groupChatsService.isUserBlockedBy(userId, pId);
      if (!hasBlockedSender) unblockedParticipantIds.push(pId);
    }

    this.domainEventService.emit('message:new', message, unblockedParticipantIds);
    this.domainEventService.emit('conversation:updated', {
      conversationId: message.conversationId,
      publicId: message.publicId,
      internalId: message.internalId,
      lastMessage: {
        text: message.text,
        createdAt: message.createdAt,
        senderId: userId
      }
    }, unblockedParticipantIds);

    for (const pId of unblockedParticipantIds) {
      const isMuted = await this.groupChatsService.isUserConversationMuted(conversationId, pId);
      if (!isMuted) {
        this.notificationsService.createNotification(
          this.notificationFactory.createMessage(
            { id: userId, displayName: message.senderName, avatar: message.senderAvatar },
            conv || { id: conversationId, name: message.senderName },
            pId,
            message.text
          )
        ).catch(() => {});
      }
    }

    this.domainEventService.emit('message:new', message, [userId]);

    return message;
  }

  @Post(':id/read')
  @UseGuards(JwtGuard)
  async markAsRead(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.groupChatsService.markAsRead(conversationId, userId);
  }

  @Patch(':id/mute')
  @UseGuards(JwtGuard)
  async muteConversation(@Req() req: any, @Param('id') conversationId: string, @Body('muted') muted: boolean) {
    const userId = req.user?.id;
    return this.groupChatsService.muteConversation(conversationId, userId, muted);
  }

  @Patch(':id/pin')
  @UseGuards(JwtGuard)
  async pinConversation(@Req() req: any, @Param('id') conversationId: string, @Body('pinned') pinned: boolean) {
    const userId = req.user?.id;
    return this.groupChatsService.pinConversation(conversationId, userId, pinned);
  }

  @Post(':id/clear')
  @UseGuards(JwtGuard)
  async clearChat(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.groupChatsService.clearChatForUser(conversationId, userId);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async deleteConversation(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.groupChatsService.deleteConversationForUser(conversationId, userId);
  }

  private async broadcastSystemMessage(conversationId: string, senderId: string, text: string) {
    try {
      const message = await this.groupChatsService.createSystemMessage(conversationId, senderId, text);
      const participantIds = await this.groupChatsService.getConversationParticipantIds(conversationId);
      this.domainEventService.emit('message:new', message, participantIds);
      return message;
    } catch {
      // ignore
    }
  }

  @Patch(':id/info')
  @UseGuards(JwtGuard)
  async updateGroupInfo(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: { name?: string; description?: string; avatarKey?: string; avatar?: string }
  ) {
    const userId = req.user?.id;
    const { updated, convBefore, actorHandle, participantIds } = await this.groupChatsService.updateGroupInfo(conversationId, userId, body);

    const newAvatar = body.avatarKey !== undefined ? body.avatarKey : body.avatar;
    const avatarChanged = newAvatar !== undefined && newAvatar !== (convBefore?.avatarKey || null);
    const nameChanged = body.name !== undefined && body.name !== (convBefore?.name || null);
    const descChanged = body.description !== undefined && body.description !== (convBefore?.description || null);

    let text = '';
    if (avatarChanged && nameChanged) text = `${actorHandle} updated group avatar and name`;
    else if (avatarChanged) text = `${actorHandle} changed group avatar`;
    else if (nameChanged) text = `${actorHandle} changed group name to "${body.name}"`;
    else if (descChanged) text = `${actorHandle} updated group description`;
    else if (body.name || body.avatarKey || body.avatar || body.description) text = `${actorHandle} updated group details`;

    setImmediate(async () => {
      if (text) {
        await this.groupChatsService.createSystemMessage(conversationId, userId, text).catch(() => {});
      }
      const pubId = (updated as any).publicId || updated.id;
      this.domainEventService.emit('conversation:updated', {
        id: pubId,
        publicId: pubId,
        internalId: updated.id,
        name: updated.name,
        avatar: (updated as any).avatarKey || (updated as any).avatar || null,
        description: updated.description
      }, participantIds);
    });

    return updated;
  }

  @Post(':id/members')
  @UseGuards(JwtGuard)
  async addMember(@Req() req: any, @Param('id') conversationId: string, @Body('userId') targetUserId: string) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.addGroupMember(conversationId, userId, targetUserId);
    setImmediate(async () => {
      const [actorHandle, targetHandle] = await Promise.all([
        this.groupChatsService.getUserHandle(userId),
        this.groupChatsService.getUserHandle(targetUserId)
      ]);
      await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} added ${targetHandle} to the group`);
      this.domainEventService.emit('group:member_added', { conversationId, userId: targetUserId }, [targetUserId]);
      this.domainEventService.emit('conversation:updated', { conversationId }, [targetUserId]);
    });
    return result;
  }

  @Delete(':id/members/:targetUserId')
  @UseGuards(JwtGuard)
  async removeMember(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.removeGroupMember(conversationId, userId, targetUserId);

    setImmediate(async () => {
      const [actorHandle, targetHandle, remainingParticipantIds] = await Promise.all([
        this.groupChatsService.getUserHandle(userId),
        this.groupChatsService.getUserHandle(targetUserId),
        this.groupChatsService.getConversationParticipantIds(conversationId)
      ]);
      const text = `${actorHandle} removed ${targetHandle} from the group`;
      const message = await this.groupChatsService.createSystemMessage(conversationId, userId, text);

      this.domainEventService.emit('group:member_removed', { conversationId, targetUserId, removedBy: userId, message }, [targetUserId]);
      this.domainEventService.emit('message:new', message, [targetUserId]);

      const others = remainingParticipantIds.filter(pId => pId !== targetUserId);
      if (others.length > 0) {
        this.domainEventService.emit('message:new', message, others);
        this.domainEventService.emit('group:member_removed', { conversationId, targetUserId, removedBy: userId, message }, others);
      }
    });

    return result;
  }

  @Post(':id/leave')
  @UseGuards(JwtGuard)
  async leaveGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.leaveGroup(conversationId, userId);

    setImmediate(async () => {
      const [actorHandle, remainingParticipantIds] = await Promise.all([
        this.groupChatsService.getUserHandle(userId),
        this.groupChatsService.getConversationParticipantIds(conversationId)
      ]);
      const text = `${actorHandle} left the group`;
      const message = await this.groupChatsService.createSystemMessage(conversationId, userId, text);

      this.domainEventService.emit('group:member_removed', {
        conversationId,
        targetUserId: userId,
        removedBy: userId,
        message
      }, [userId]);

      const others = remainingParticipantIds.filter(pId => pId !== userId);
      if (others.length > 0) {
        this.domainEventService.emit('message:new', message, others);
        this.domainEventService.emit('group:member_removed', {
          conversationId,
          targetUserId: userId,
          removedBy: userId,
          message
        }, others);
      }
    });

    return result;
  }

  @Patch(':id/settings')
  @UseGuards(JwtGuard)
  async updateSettings(@Req() req: any, @Param('id') conversationId: string, @Body() body: any) {
    const userId = req.user?.id;
    return this.groupChatsService.updateGroupSettings(conversationId, userId, body);
  }

  @Patch(':id/permissions')
  @UseGuards(JwtGuard)
  async updatePermissions(@Req() req: any, @Param('id') conversationId: string, @Body('permission') permission: string) {
    const userId = req.user?.id;
    return this.groupChatsService.updateGroupEditPermission(conversationId, userId, permission);
  }

  @Post(':id/owner')
  @UseGuards(JwtGuard)
  async changeOwner(@Req() req: any, @Param('id') conversationId: string, @Body('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.changeGroupOwner(conversationId, userId, targetUserId);
    const actorHandle = await this.groupChatsService.getUserHandle(userId);

    const participantIds = await this.groupChatsService.getConversationParticipantIds(conversationId);
    if (participantIds.length > 0) {
      this.domainEventService.emit('conversation:updated', {
        conversationId,
        ownerId: targetUserId
      }, participantIds);
    }

    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} transferred group ownership to ${targetHandle}`);
    return result;
  }

  @Post(':id/admins')
  @UseGuards(JwtGuard)
  async promoteAdmin(@Req() req: any, @Param('id') conversationId: string, @Body('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.promoteToAdmin(conversationId, userId, targetUserId);
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} promoted ${targetHandle} to Admin`);
    return result;
  }

  @Delete(':id/admins/:targetUserId')
  @UseGuards(JwtGuard)
  async demoteAdmin(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.demoteFromAdmin(conversationId, userId, targetUserId);
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} demoted ${targetHandle} to Member`);
    return result;
  }

  @Post(':id/end')
  @UseGuards(JwtGuard)
  async endGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} closed the group`);
    return this.groupChatsService.endGroup(conversationId, userId);
  }

  @Post(':id/requests/:targetUserId/accept')
  @UseGuards(JwtGuard)
  async acceptJoinRequest(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.groupChatsService.getUserHandle(targetUserId);
    const result = await this.groupChatsService.acceptGroupJoinRequest(conversationId, userId, targetUserId);
    const actorHandle = await this.groupChatsService.getUserHandle(userId);
    const text = `${actorHandle} approved ${targetHandle}'s request to join`;
    await this.broadcastSystemMessage(conversationId, userId, text);

    this.domainEventService.emit('group:member_added', { conversationId, userId: targetUserId }, [targetUserId]);
    return result;
  }

  @Post(':id/requests/:targetUserId/decline')
  @UseGuards(JwtGuard)
  async declineJoinRequest(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    return this.groupChatsService.declineGroupJoinRequest(conversationId, userId, targetUserId);
  }

  @Post(':id/join')
  @UseGuards(JwtGuard)
  async joinGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.requestGroupJoin(conversationId, userId);
    if (result.status === 'JOINED') {
      const userHandle = await this.groupChatsService.getUserHandle(userId);
      await this.broadcastSystemMessage(conversationId, userId, `${userHandle} joined the group`);
    }
    return result;
  }

  @Delete('msg/:messageId/for-me')
  @UseGuards(JwtGuard)
  async deleteMessageForMe(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    return this.groupChatsService.deleteMessageForMe(messageId, userId);
  }

  @Delete('msg/:messageId')
  @UseGuards(JwtGuard)
  async unsendMessage(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    const result = await this.groupChatsService.unsendMessage(messageId, userId);
    if (result.success && result.conversationId) {
      const pubId = (result as any).publicId || result.conversationId;
      const participantIds = (result as any).participantIds || [];
      setImmediate(() => {
        this.domainEventService.emit('message:updated', {
          id: messageId,
          conversationId: pubId,
          publicId: pubId,
          internalId: result.conversationId,
          state: 'UNSENT',
          text: 'This message was unsent',
          mediaUrl: null,
          mediaType: null,
          inviteData: null,
          replyTo: null
        }, participantIds);
        this.domainEventService.emit('conversation:updated', {
          conversationId: pubId,
          lastMessageText: 'This message was unsent',
          updatedAt: new Date().toISOString()
        }, participantIds);
      });
    }
    return result;
  }

  @Post('msg/:messageId/forward')
  @UseGuards(JwtGuard)
  async forwardMessage(@Req() req: any, @Param('messageId') messageId: string, @Body('targetConversationIds') targetConversationIds: string[]) {
    const userId = req.user?.id;
    if (!Array.isArray(targetConversationIds) || targetConversationIds.length === 0) {
      throw new BadRequestException('targetConversationIds array is required');
    }
    const result = await this.groupChatsService.forwardMessage(messageId, targetConversationIds, userId);

    if (result.messages && Array.isArray(result.messages)) {
      for (const message of result.messages) {
        const conversationId = message.conversationId;
        const participantIds = await this.groupChatsService.getConversationParticipantIds(conversationId);
        const conv = await this.groupChatsService.getConversationById(conversationId);

        const otherParticipantIds = participantIds.filter(pId => pId !== userId);
        const unblockedParticipantIds = [];
        for (const pId of otherParticipantIds) {
          const hasBlockedSender = await this.groupChatsService.isUserBlockedBy(userId, pId);
          if (!hasBlockedSender) unblockedParticipantIds.push(pId);
        }

        this.domainEventService.emit('message:new', message, unblockedParticipantIds);
        this.domainEventService.emit('conversation:updated', {
          conversationId: message.conversationId,
          publicId: message.publicId,
          internalId: message.internalId,
          lastMessage: {
            text: message.text || (message.mediaUrl ? (message.mediaType === 'image' ? 'Photo' : message.mediaType === 'video' ? 'Video' : 'Audio') : ''),
            createdAt: message.createdAt,
            senderId: userId
          }
        }, unblockedParticipantIds);

        for (const pId of unblockedParticipantIds) {
          const isMuted = await this.groupChatsService.isUserConversationMuted(conversationId, pId);
          if (!isMuted) {
            this.notificationsService.createNotification(
              this.notificationFactory.createMessage(
                { id: userId, displayName: message.senderName, avatar: message.senderAvatar },
                conv || { id: conversationId, name: message.senderName },
                pId,
                message.text || 'Forwarded a message'
              )
            ).catch(() => {});
          }
        }
        this.domainEventService.emit('message:new', message, [userId]);
      }
    }

    return result;
  }

  @Post(':id/react')
  @UseGuards(JwtGuard)
  async reactToMessage(@Req() req: any, @Param('id') messageId: string, @Body('reaction') reaction: string) {
    const userId = req.user?.id;
    return this.groupChatsService.reactToMessage(messageId, userId, reaction);
  }
}
