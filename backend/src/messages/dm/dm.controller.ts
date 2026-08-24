import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { DmService } from './dm.service';
import { BlocksService } from '../../users/blocks.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { DomainEventService } from '../../events/domain-event.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationFactory } from '../../notifications/notification.factory';
import { SendMessageDto } from '../core/dto/send-message.dto';

@Controller('api/dm')
export class DmController {
  constructor(
    private readonly dmService: DmService,
    private readonly domainEventService: DomainEventService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly blocksService: BlocksService,
  ) {}

  @Get()
  @UseGuards(JwtGuard)
  async getConversations(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.dmService.getUserDMConversations(userId, limitNum, offsetNum);
  }

  @Get('lookup/:targetUserId')
  @UseGuards(JwtGuard)
  async lookupExistingDM(@Req() req: any, @Param('targetUserId') targetUserId: string) {
    const userId = req.user?.id;
    return this.dmService.lookupExistingDM(userId, targetUserId);
  }

  @Post()
  @UseGuards(JwtGuard)
  async startDM(
    @Req() req: any,
    @Body('targetUserId') targetUserId?: string,
    @Body('userIds') userIdsBody?: string | string[]
  ) {
    const userId = req.user?.id;
    let targetId = targetUserId;
    if (!targetId && userIdsBody) {
      targetId = Array.isArray(userIdsBody) ? userIdsBody[0] : userIdsBody;
    }
    if (!targetId) {
      throw new BadRequestException('targetUserId is required');
    }

    const res = await this.dmService.startDM(userId, targetId);
    this.domainEventService.emit('conversation:updated', { conversationId: res.id }, [targetId]);
    return res;
  }

  @Post('instant-match')
  @UseGuards(JwtGuard)
  async createInstantMatch(
    @Req() req: any,
    @Body() body: { targetUserId: string; activity: string }
  ) {
    const userId = req.user?.id;
    return this.dmService.createInstantMatchDM(userId, body.targetUserId, body.activity);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  async getHistory(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Query('before') beforeCursor?: string,
    @Query('limit') limit?: string
  ) {
    const userId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.dmService.getConversationHistory(conversationId, userId, beforeCursor, limitNum);
  }

  @Post(':id/messages')
  @UseGuards(JwtGuard)
  async sendMessage(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: SendMessageDto
  ) {
    const userId = req.user?.id;
    const message = await this.dmService.sendMessage(userId, conversationId, body);

    const unblockedParticipantIds = message.recipientIds || [];
    const unmutedRecipientIds = message.unmutedRecipientIds || [];
    const allParticipantIds = Array.from(new Set([userId, ...unblockedParticipantIds]));

    const previewText = message.text || (message.inviteData ? (message.inviteData.type === 'postShare' ? 'Shared a post' : (message.inviteData.groupName ? `Group invite: ${message.inviteData.groupName}` : 'Group invite')) : '');

    setImmediate(() => {
      this.domainEventService.emit('message:new', message, unblockedParticipantIds).catch(() => {});
      this.domainEventService.emit('conversation:updated', {
        conversationId: message.conversationId,
        publicId: message.publicId,
        internalId: message.internalId,
        lastMessage: {
          text: previewText,
          createdAt: message.createdAt,
          senderId: userId
        }
      }, allParticipantIds).catch(() => {});
      this.domainEventService.emit('message:new', message, [userId]).catch(() => {});

      for (const pId of unmutedRecipientIds) {
        this.notificationsService.createNotification(
          this.notificationFactory.createMessage(
            { id: userId, displayName: message.senderName, avatar: message.senderAvatar },
            { id: conversationId, name: message.conversationName || message.senderName },
            pId,
            previewText
          )
        ).catch(() => {});
      }
    });

    return message;
  }

  @Post(':id/read')
  @UseGuards(JwtGuard)
  async markAsRead(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.dmService.markAsRead(conversationId, userId);
  }

  @Patch(':id/mute')
  @UseGuards(JwtGuard)
  async muteConversation(@Req() req: any, @Param('id') conversationId: string, @Body('muted') muted: boolean) {
    const userId = req.user?.id;
    return this.dmService.muteConversation(conversationId, userId, muted);
  }

  @Patch(':id/pin')
  @UseGuards(JwtGuard)
  async pinConversation(@Req() req: any, @Param('id') conversationId: string, @Body('pinned') pinned: boolean) {
    const userId = req.user?.id;
    return this.dmService.pinConversation(conversationId, userId, pinned);
  }

  @Post(':id/clear')
  @UseGuards(JwtGuard)
  async clearChat(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.dmService.clearChatForUser(conversationId, userId);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async deleteConversation(@Req() req: any, @Param('id') conversationId: string) {
    const userId = req.user?.id;
    return this.dmService.deleteConversationForUser(conversationId, userId);
  }

  @Delete('msg/:messageId/for-me')
  @UseGuards(JwtGuard)
  async deleteMessageForMe(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    return this.dmService.deleteMessageForMe(messageId, userId);
  }

  @Delete('msg/:messageId')
  @UseGuards(JwtGuard)
  async unsendMessage(@Req() req: any, @Param('messageId') messageId: string) {
    const userId = req.user?.id;
    const result = await this.dmService.unsendMessage(messageId, userId);
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
    const result = await this.dmService.forwardMessage(messageId, targetConversationIds, userId);

    if (result.messages && Array.isArray(result.messages)) {
      for (const message of result.messages) {
        const conversationId = message.conversationId;
        const participantIds = await this.dmService.getConversationParticipantIds(conversationId);
        const conv = await this.dmService.getConversationById(conversationId);

        const otherParticipantIds = participantIds.filter(pId => pId !== userId);
        // Was an N+1 of isUserBlockedBy (one query per participant) against a
        // method that duplicated BlocksService. One cached call now answers for
        // the whole list, in both directions.
        const unblockedParticipantIds = await this.blocksService.filterBlockedUsers(
          userId,
          otherParticipantIds,
        );

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
          const isMuted = await this.dmService.isUserConversationMuted(conversationId, pId);
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
    return this.dmService.reactToMessage(messageId, userId, reaction);
  }
}
