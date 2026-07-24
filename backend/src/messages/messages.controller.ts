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
    @Query('deviceId') deviceId?: string
  ) {
    const userId = req.user?.id;
    return this.messagesService.getConversationHistory(conversationId, userId, deviceId);
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
          conversationId,
          lastMessage: {
            text: message.text,
            createdAt: message.createdAt,
            senderId: userId
          }
        });

        this.notificationsService.createNotification(
          this.notificationFactory.createMessage(
            { id: userId, displayName: message.senderName, avatar: message.senderAvatar },
            { id: conversationId, name: message.senderName },
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
    if (userIdsBody && Array.isArray(userIdsBody)) {
      targetUserIds = userIdsBody;
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

  @Patch(':id/group')
  @UseGuards(JwtGuard)
  async updateGroupInfo(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: { name?: string; description?: string; avatarKey?: string }
  ) {
    const userId = req.user?.id;
    return this.messagesService.updateGroupInfo(conversationId, userId, body);
  }

  @Post(':id/members')
  @UseGuards(JwtGuard)
  async addMember(@Req() req: any, @Param('id') conversationId: string, @Body('userId') targetUserId: string) {
    const userId = req.user?.id;
    return this.messagesService.addGroupMember(conversationId, userId, targetUserId);
  }

  @Delete(':id/members/:targetUserId')
  @UseGuards(JwtGuard)
  async removeMember(@Req() req: any, @Param('id') conversationId: string, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    return this.messagesService.removeGroupMember(conversationId, userId, targetUserId);
  }

  @Post(':id/leave')
  @UseGuards(JwtGuard)
  async leaveGroup(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.messagesService.leaveGroup(conversationId, userId);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async unsendMessage(@Req() req: any, @Param('id') messageId: string) {
    const userId = req.user?.id;
    const result = await this.messagesService.unsendMessage(messageId, userId);
    if (result.success && result.conversationId) {
      this.realtimeGateway.emitToConversation(result.conversationId, 'message:deleted', {
        messageId,
        conversationId: result.conversationId,
      });
    }
    return result;
  }
}
