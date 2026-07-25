import { Controller, Get, Post, Patch, Body, Param, UseGuards, Req, Query, Delete } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';

@Controller('api/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
  ) {}

  @Get()
  @UseGuards(JwtGuard)
  async getConversations(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
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
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.messagesService.getConversationHistory(conversationId, userId, deviceId, beforeCursor, limitNum);
  }

  @Post(':id/messages')
  @UseGuards(JwtGuard)
  async sendMessage(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: { text?: string; mediaUrl?: string; mediaType?: string; mentions?: string[]; replyToId?: string; inviteData?: any }
  ) {
    const userId = req.user?.id;
    const message = await this.messagesService.sendMessage(userId, conversationId, body);
    const conv = await this.messagesService.getConversationById(conversationId);
    
    // Broadcast message & update notifications only to non-blocking participants (Instagram block model)
    const participantIds = await this.messagesService.getConversationParticipantIds(conversationId);
    for (const pId of participantIds) {
      if (pId !== userId) {
        const hasBlockedSender = await this.messagesService.isUserBlockedBy(userId, pId);
        if (hasBlockedSender) {
          // Recipient blocked the sender: silently ignore (do not notify or update inbox of blocker)
          continue;
        }

        this.realtimeGateway.server.to(pId).emit('message:new', message);

        this.realtimeGateway.server.to(pId).emit('conversation:updated', {
          conversationId: message.conversationId,
          publicId: message.publicId,
          internalId: message.internalId,
          lastMessage: {
            text: message.text,
            createdAt: message.createdAt,
            senderId: userId
          }
        });

        this.notificationsService.createNotification(
          this.notificationFactory.createMessage(
            { id: userId, displayName: message.senderName, avatar: message.senderAvatar },
            conv || { id: conversationId, name: message.senderName },
            pId,
            message.text
          )
        ).catch(() => {});
      } else {
        this.realtimeGateway.server.to(userId).emit('message:new', message);
      }
    }

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
    return this.messagesService.startConversation(targetUserIds, userId, nameBody);
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
      for (const pId of participantIds) {
        this.realtimeGateway.server.to(pId).emit('message:new', message);
      }
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
    const result = await this.messagesService.updateGroupInfo(conversationId, userId, body);
    const actorHandle = await this.messagesService.getUserHandle(userId);
    let text = `${actorHandle} updated the group details`;
    if (body.name && body.description) text = `${actorHandle} updated group name and description`;
    else if (body.name) text = `${actorHandle} changed group name to "${body.name}"`;
    else if (body.avatarKey || body.avatar) text = `${actorHandle} changed group photo`;
    else if (body.description) text = `${actorHandle} updated group description`;
    await this.broadcastSystemMessage(conversationId, userId, text);
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

    if (this.realtimeGateway?.server) {
      this.realtimeGateway.server.to(targetUserId).emit('group:member_removed', {
        conversationId,
        targetUserId,
        removedBy: userId,
        message
      });
      this.realtimeGateway.server.to(targetUserId).emit('message:new', message);

      const remainingParticipantIds = await this.messagesService.getConversationParticipantIds(conversationId);
      for (const pId of remainingParticipantIds) {
        if (pId !== targetUserId) {
          this.realtimeGateway.server.to(pId).emit('message:new', message);
          this.realtimeGateway.server.to(pId).emit('group:member_removed', {
            conversationId,
            targetUserId,
            removedBy: userId,
            message
          });
        }
      }
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

    if (this.realtimeGateway?.server) {
      this.realtimeGateway.server.to(userId).emit('group:member_removed', {
        conversationId,
        targetUserId: userId,
        removedBy: userId,
        message
      });

      const remainingParticipantIds = await this.messagesService.getConversationParticipantIds(conversationId);
      for (const pId of remainingParticipantIds) {
        if (pId !== userId) {
          this.realtimeGateway.server.to(pId).emit('message:new', message);
          this.realtimeGateway.server.to(pId).emit('group:member_removed', {
            conversationId,
            targetUserId: userId,
            removedBy: userId,
            message
          });
        }
      }
    }

    return result;
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async unsendMessage(@Req() req: any, @Param('id') messageId: string) {
    const userId = req.user?.id;
    const result = await this.messagesService.unsendMessage(messageId, userId);
    if (result.success && result.conversationId) {
      const participantIds = await this.messagesService.getConversationParticipantIds(result.conversationId);
      for (const pId of participantIds) {
        this.realtimeGateway.server.to(pId).emit('message:deleted', {
          messageId,
          conversationId: result.conversationId,
        });
      }
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

    if (this.realtimeGateway?.server) {
      this.realtimeGateway.server.to(targetUserId).emit('group:member_added', { conversationId, userId: targetUserId });
    }
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
