import { Controller, Get, Post, Patch, Body, Param, UseGuards, Req, Query, Delete, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { DomainEventService } from '../events/domain-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { SendMessageDto } from './core/dto/send-message.dto';

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
  async deleteMessageForMe(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    return this.messagesService.deleteMessageForMe(messageId, userId);
  }

  @Delete('msg/:messageId')
  @UseGuards(JwtGuard)
  async unsendMessage(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    const result = await this.messagesService.unsendMessage(messageId, userId);
    if (result.success && result.conversationId) {
      const conv = await this.messagesService.getConversationById(result.conversationId);
      const pubId = (conv as any)?.publicId || result.conversationId;
      const participantIds = await this.messagesService.getConversationParticipantIds(result.conversationId);
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
    const result = await this.messagesService.forwardMessage(messageId, targetConversationIds, userId);

    if (result.messages && Array.isArray(result.messages)) {
      for (const message of result.messages) {
        const conversationId = message.conversationId;
        const participantIds = await this.messagesService.getConversationParticipantIds(conversationId);
        const conv = await this.messagesService.getConversationById(conversationId);

        const otherParticipantIds = participantIds.filter(pId => pId !== userId);
        
        // Filter out those who blocked the sender
        const unblockedParticipantIds = [];
        for (const pId of otherParticipantIds) {
          const hasBlockedSender = await this.messagesService.isUserBlockedBy(userId, pId);
          if (!hasBlockedSender) unblockedParticipantIds.push(pId);
        }

        // Emit to others
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

        // Notifications
        for (const pId of unblockedParticipantIds) {
          const isMuted = await this.messagesService.isUserConversationMuted(conversationId, pId);
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
        
        // Emit to sender
        this.domainEventService.emit('message:new', message, [userId]);
      }
    }

    return result;
  }

  @Get()
  @UseGuards(JwtGuard)
  async getConversations(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const userId = req.user?.id;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const limitNum = isNaN(parsedLimit) ? 20 : parsedLimit;
    const offsetNum = isNaN(parsedOffset) ? 0 : parsedOffset;
    return this.messagesService.getUserConversations(userId, limitNum, offsetNum);
  }

  @Get(':conversationId')
  @UseGuards(JwtGuard)
  async getHistory(
    @Req() req: any,
    @Param('conversationId') conversationId: string, 
    @Query('deviceId') deviceId?: string,
    @Query('before') beforeCursor?: string,
    @Query('limit') limit?: string
  ) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.messagesService.getConversationHistory(conversationId, userId, deviceId, beforeCursor, limitNum);
  }

  @Post(':id/messages')
  @UseGuards(JwtGuard)
  async sendMessage(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: SendMessageDto
  ) {
    const userId = req.user?.id;
    const message = await this.messagesService.sendMessage(userId, conversationId, body);
    const conv = await this.messagesService.getConversationById(conversationId);
    
    // Broadcast message & update notifications only to non-blocking participants (Instagram block model)
    const participantIds = await this.messagesService.getConversationParticipantIds(conversationId);
    const otherParticipantIds = participantIds.filter(pId => pId !== userId);
    const unblockedParticipantIds = [];
    for (const pId of otherParticipantIds) {
      const hasBlockedSender = await this.messagesService.isUserBlockedBy(userId, pId);
      if (!hasBlockedSender) unblockedParticipantIds.push(pId);
    }

    // Emit to others
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
      const isMuted = await this.messagesService.isUserConversationMuted(conversationId, pId);
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
    
    // Emit to sender
    this.domainEventService.emit('message:new', message, [userId]);

    return message;
  }

  @Post()
  @UseGuards(JwtGuard)
  async startConversation(
    @Req() req: any, 
    @Query('userIds') userIdsQuery?: string, 
    @Body('userIds') userIdsBody?: string[],
    @Body('name') nameBody?: string
  ) {
    const userId = req.user?.id;
    let targetUserIds: string[] = [];
    if (userIdsBody) {
      if (Array.isArray(userIdsBody)) {
        targetUserIds = userIdsBody.map((item: any) => typeof item === 'string' ? item : (item?.id || item?.userId)).filter(Boolean);
      } else if (typeof userIdsBody === 'string') {
        targetUserIds = [userIdsBody];
      } else if (typeof userIdsBody === 'object') {
        const singleId = (userIdsBody as any).id || (userIdsBody as any).userId;
        if (singleId) targetUserIds = [singleId];
      }
    } else if (userIdsQuery) {
      targetUserIds = userIdsQuery.split(',');
    }
    const res = await this.messagesService.startConversation(targetUserIds, userId, nameBody);
    if (targetUserIds.length > 0) {
      const others = targetUserIds.filter(tId => tId && tId !== userId);
      if (others.length > 0) {
        this.domainEventService.emit('group:member_added', { conversationId: res.id, userId }, others);
        this.domainEventService.emit('conversation:updated', { conversationId: res.id }, others);
      }
    }
    return res;
  }

  @Post('instant-match')
  @UseGuards(JwtGuard)
  async createInstantMatch(
    @Req() req: any,
    @Body() body: { targetUserId: string; activity: string }
  ) {
    const userId = req.user?.id;
    return this.messagesService.createInstantMatchConversation(userId, body.targetUserId, body.activity);
  }

  @Post(':id/react')
  @UseGuards(JwtGuard)
  async reactToMessage(@Req() req: any, @Param('id') messageId: string, @Body('reaction') reaction: string) {
    const userId = req.user?.id;
    return this.messagesService.reactToMessage(messageId, userId, reaction);
  }

  @Post(':id/read')
  @UseGuards(JwtGuard)
  async markAsRead(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.messagesService.markAsRead(conversationId, userId);
  }

  @Patch(':id/mute')
  @UseGuards(JwtGuard)
  async muteConversation(@Req() req: any, @Param('id') conversationId: string, @Body('muted') muted: boolean) {
    const userId = req.user?.id;
    return this.messagesService.muteConversation(conversationId, userId, muted);
  }

  @Patch(':id/pin')
  @UseGuards(JwtGuard)
  async pinConversation(@Req() req: any, @Param('id') conversationId: string, @Body('pinned') pinned: boolean) {
    const userId = req.user?.id;
    return this.messagesService.pinConversation(conversationId, userId, pinned);
  }

  @Post(':id/clear')
  @UseGuards(JwtGuard)
  async clearChat(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.messagesService.clearChatForUser(conversationId, userId);
  }

  @Delete(':id/conversations')
  @UseGuards(JwtGuard)
  async deleteConversation(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.messagesService.deleteConversationForUser(conversationId, userId);
  }

  private async broadcastSystemMessage(conversationId: string, senderId: string, text: string) {
    try {
      const message = await this.messagesService.createSystemMessage(conversationId, senderId, text);
      const participantIds = await this.messagesService.getConversationParticipantIds(conversationId);
      this.domainEventService.emit('message:new', message, participantIds);
      return message;
    } catch {
      // Ignore background system message errors
    }
  }

  @Patch(':id/group')
  @UseGuards(JwtGuard)
  async updateGroupInfo(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: { name?: string; description?: string; avatarKey?: string; avatar?: string }
  ) {
    const userId = req.user?.id;
    const realConvId = await this.messagesService.resolveConversationId(conversationId);
    const convBefore = await this.messagesService.getConversationById(realConvId);

    const result = await this.messagesService.updateGroupInfo(conversationId, userId, body);
    const actorHandle = await this.messagesService.getUserHandle(userId);

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

    if (text) {
      await this.broadcastSystemMessage(conversationId, userId, text);
    }

    if (result) {
      const pubId = (result as any).publicId || result.id;
      const pIds = await this.messagesService.getConversationParticipantIds(result.id);
      this.domainEventService.emit('conversation:updated', {
        id: pubId,
        publicId: pubId,
        internalId: result.id,
        name: result.name,
        avatar: (result as any).avatarKey || (result as any).avatar || null,
        description: result.description
      }, pIds);
    }

    return result;
  }

  @Post(':id/members')
  @UseGuards(JwtGuard)
  async addMember(@Req() req: any, @Param('id') conversationId: string, @Body('userId') targetUserId: string) {
    const userId = req.user?.id;
    const result = await this.messagesService.addGroupMember(conversationId, userId, targetUserId);
    const actorHandle = await this.messagesService.getUserHandle(userId);
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} added ${targetHandle} to the group`);

    this.domainEventService.emit('group:member_added', { conversationId, userId: targetUserId }, [targetUserId]);
    this.domainEventService.emit('conversation:updated', { conversationId }, [targetUserId]);
    return result;
  }

  @Delete(':id/members/:targetUserId')
  @UseGuards(JwtGuard)
  async removeMember(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    const actorHandle = await this.messagesService.getUserHandle(userId);
    const text = `${actorHandle} removed ${targetHandle} from the group`;
    const message = await this.messagesService.createSystemMessage(conversationId, userId, text);

    const result = await this.messagesService.removeGroupMember(conversationId, userId, targetUserId);

    this.domainEventService.emit('group:member_removed', {
      conversationId,
      targetUserId,
      removedBy: userId,
      message
    }, [targetUserId]);
    this.domainEventService.emit('message:new', message, [targetUserId]);

    const remainingParticipantIds = await this.messagesService.getConversationParticipantIds(conversationId);
    const others = remainingParticipantIds.filter(pId => pId !== targetUserId);
    if (others.length > 0) {
      this.domainEventService.emit('message:new', message, others);
      this.domainEventService.emit('group:member_removed', {
        conversationId,
        targetUserId,
        removedBy: userId,
        message
      }, others);
    }

    return result;
  }

  @Post(':id/leave')
  @UseGuards(JwtGuard)
  async leaveGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    const actorHandle = await this.messagesService.getUserHandle(userId);
    const text = `${actorHandle} left the group`;
    const message = await this.messagesService.createSystemMessage(conversationId, userId, text);

    const result = await this.messagesService.leaveGroup(conversationId, userId);

    this.domainEventService.emit('group:member_removed', {
      conversationId,
      targetUserId: userId,
      removedBy: userId,
      message
    }, [userId]);

    const remainingParticipantIds = await this.messagesService.getConversationParticipantIds(conversationId);
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

    return result;
  }

  @Patch(':id/settings')
  @UseGuards(JwtGuard)
  async updateSettings(@Req() req: any, @Param('id') conversationId: string, @Body() body: any) {
    const userId = req.user?.id;
    return this.messagesService.updateGroupSettings(conversationId, userId, body);
  }

  @Patch(':id/permissions')
  @UseGuards(JwtGuard)
  async updatePermissions(@Req() req: any, @Param('id') conversationId: string, @Body('permission') permission: string) {
    const userId = req.user?.id;
    return this.messagesService.updateGroupEditPermission(conversationId, userId, permission);
  }

  @Post(':id/owner')
  @UseGuards(JwtGuard)
  async changeOwner(@Req() req: any, @Param('id') conversationId: string, @Body('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    const result = await this.messagesService.changeGroupOwner(conversationId, userId, targetUserId);
    const actorHandle = await this.messagesService.getUserHandle(userId);

    const participantIds = await this.messagesService.getConversationParticipantIds(conversationId);
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
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    const result = await this.messagesService.promoteToAdmin(conversationId, userId, targetUserId);
    const actorHandle = await this.messagesService.getUserHandle(userId);
    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} promoted ${targetHandle} to Admin`);
    return result;
  }

  @Delete(':id/admins/:targetUserId')
  @UseGuards(JwtGuard)
  async demoteAdmin(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    const result = await this.messagesService.demoteFromAdmin(conversationId, userId, targetUserId);
    const actorHandle = await this.messagesService.getUserHandle(userId);
    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} demoted ${targetHandle} to Member`);
    return result;
  }

  @Post(':id/end')
  @UseGuards(JwtGuard)
  async endGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    const actorHandle = await this.messagesService.getUserHandle(userId);
    await this.broadcastSystemMessage(conversationId, userId, `${actorHandle} closed the group`);
    return this.messagesService.endGroup(conversationId, userId);
  }

  @Post(':id/requests/:targetUserId/accept')
  @UseGuards(JwtGuard)
  async acceptJoinRequest(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    const result = await this.messagesService.acceptGroupJoinRequest(conversationId, userId, targetUserId);
    const actorHandle = await this.messagesService.getUserHandle(userId);
    const text = `${actorHandle} approved ${targetHandle}'s request to join`;
    await this.broadcastSystemMessage(conversationId, userId, text);

    this.domainEventService.emit('group:member_added', { conversationId, userId: targetUserId }, [targetUserId]);
    return result;
  }

  @Post(':id/requests/:targetUserId/decline')
  @UseGuards(JwtGuard)
  async declineJoinRequest(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    return this.messagesService.declineGroupJoinRequest(conversationId, userId, targetUserId);
  }

  @Post(':id/join')
  @UseGuards(JwtGuard)
  async joinGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    const result = await this.messagesService.requestGroupJoin(conversationId, userId);
    if (result.status === 'JOINED') {
      const userHandle = await this.messagesService.getUserHandle(userId);
      await this.broadcastSystemMessage(conversationId, userId, `${userHandle} joined the group`);
    }
    return result;
  }

  @Post(':id/request')
  @UseGuards(JwtGuard)
  async requestJoinGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.messagesService.requestGroupJoin(conversationId, userId);
  }
}
