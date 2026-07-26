import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ActivityChatsService } from './activity-chats.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationFactory } from '../../notifications/notification.factory';
import { SendMessageDto } from '../core/dto/send-message.dto';

@Controller('api/activity-chats')
export class ActivityChatsController {
  constructor(
    private readonly activityChatsService: ActivityChatsService,
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
    return this.activityChatsService.getUserActivityConversations(userId, limitNum, offsetNum);
  }

  @Post(':activityId/init')
  @UseGuards(JwtGuard)
  async initActivityChat(@Req() req: any, @Param('activityId') activityId: string) {
    const userId = req.user?.id;
    return this.activityChatsService.initializeActivityChat(activityId, userId);
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
    const realConvId = await this.activityChatsService.resolveActivityConversationId(conversationId);
    return this.activityChatsService.getConversationHistory(realConvId, userId, deviceId, beforeCursor, limitNum);
  }

  @Post(':id/messages')
  @UseGuards(JwtGuard)
  async sendMessage(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: SendMessageDto
  ) {
    const userId = req.user?.id;
    const realConvId = await this.activityChatsService.resolveActivityConversationId(conversationId);
    const message = await this.activityChatsService.sendMessage(userId, realConvId, body);
    const conv = await this.activityChatsService.getConversationById(realConvId);

    const participantIds = await this.activityChatsService.getConversationParticipantIds(realConvId);
    for (const pId of participantIds) {
      if (pId !== userId) {
        const hasBlockedSender = await this.activityChatsService.isUserBlockedBy(userId, pId);
        if (hasBlockedSender) continue;

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

        const isMuted = await this.activityChatsService.isUserConversationMuted(realConvId, pId);
        if (!isMuted) {
          this.notificationsService.createNotification(
            this.notificationFactory.createMessage(
              { id: userId, displayName: message.senderName, avatar: message.senderAvatar },
              conv || { id: realConvId, name: message.senderName },
              pId,
              message.text
            )
          ).catch(() => {});
        }
      } else {
        this.realtimeGateway.server.to(userId).emit('message:new', message);
      }
    }

    return message;
  }

  @Post(':id/read')
  @UseGuards(JwtGuard)
  async markAsRead(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    const realConvId = await this.activityChatsService.resolveActivityConversationId(conversationId);
    return this.activityChatsService.markAsRead(realConvId, userId);
  }

  @Patch(':id/mute')
  @UseGuards(JwtGuard)
  async muteConversation(@Req() req: any, @Param('id') conversationId: string, @Body('muted') muted: boolean) {
    const userId = req.user?.id;
    const realConvId = await this.activityChatsService.resolveActivityConversationId(conversationId);
    return this.activityChatsService.muteConversation(realConvId, userId, muted);
  }

  @Delete('msg/:messageId/for-me')
  @UseGuards(JwtGuard)
  async deleteMessageForMe(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    return this.activityChatsService.deleteMessageForMe(messageId, userId);
  }

  @Delete('msg/:messageId')
  @UseGuards(JwtGuard)
  async unsendMessage(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    const result = await this.activityChatsService.unsendMessage(messageId, userId);
    if (result.success && result.conversationId) {
      const conv = await this.activityChatsService.getConversationById(result.conversationId);
      const pubId = (conv as any)?.publicId || result.conversationId;
      const participantIds = await this.activityChatsService.getConversationParticipantIds(result.conversationId);
      for (const pId of participantIds) {
        this.realtimeGateway.server.to(pId).emit('message:updated', {
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
        });
      }
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
    const result = await this.activityChatsService.forwardMessage(messageId, targetConversationIds, userId);

    if (result.messages && Array.isArray(result.messages)) {
      for (const message of result.messages) {
        const conversationId = message.conversationId;
        const participantIds = await this.activityChatsService.getConversationParticipantIds(conversationId);
        const conv = await this.activityChatsService.getConversationById(conversationId);

        for (const pId of participantIds) {
          if (pId !== userId) {
            const hasBlockedSender = await this.activityChatsService.isUserBlockedBy(userId, pId);
            if (hasBlockedSender) continue;

            this.realtimeGateway.server.to(pId).emit('message:new', message);
            this.realtimeGateway.server.to(pId).emit('conversation:updated', {
              conversationId: message.conversationId,
              publicId: message.publicId,
              internalId: message.internalId,
              lastMessage: {
                text: message.text || (message.mediaUrl ? (message.mediaType === 'image' ? 'Photo' : message.mediaType === 'video' ? 'Video' : 'Audio') : ''),
                createdAt: message.createdAt,
                senderId: userId
              }
            });

            const isMuted = await this.activityChatsService.isUserConversationMuted(conversationId, pId);
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
          } else {
            this.realtimeGateway.server.to(userId).emit('message:new', message);
          }
        }
      }
    }

    return result;
  }

  @Post(':id/react')
  @UseGuards(JwtGuard)
  async reactToMessage(@Req() req: any, @Param('id') messageId: string, @Body('reaction') reaction: string) {
    const userId = req.user?.id;
    return this.activityChatsService.reactToMessage(messageId, userId, reaction);
  }
}
