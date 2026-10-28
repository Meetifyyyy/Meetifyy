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
import { DmService } from './dm.service';
import { BlocksService } from '../../users/blocks.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { VerifiedOnly } from '../../common/decorators/verified-only.decorator';
import { DomainEventService } from '../../events/domain-event.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationFactory } from '../../notifications/notification.factory';
import { SendMessageDto } from '../core/dto/send-message.dto';
import { SendGroupInviteDto } from '../core/dto/send-group-invite.dto';
import { emitMessageNew, publicMessage } from '../message-alert.util';
import { VerificationAccessService } from '../../common/verification/verification-access.service';
import { announceUnsent } from '../unsend-announce.util';
import { previewOf } from '../core/message-preview';

@Controller('api/dm')
export class DmController {
  constructor(
    private readonly dmService: DmService,
    private readonly domainEventService: DomainEventService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    private readonly blocksService: BlocksService,
    private readonly verificationAccess: VerificationAccessService,
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
    return this.dmService.getUserDMConversations(userId, limitNum, offsetNum);
  }

  @Get('lookup/:targetUserId')
  @UseGuards(JwtGuard)
  async lookupExistingDM(
    @Req() req: AuthenticatedRequest,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    return this.dmService.lookupExistingDM(userId, targetUserId);
  }

  /**
   * Can these two people message each other right now?
   *
   * The composer state is derived from the conversation payload wherever one
   * exists. This endpoint covers the case that has no conversation yet — the
   * draft screen opened from a profile's Message button — so it can render the
   * unavailable state without first creating a conversation row to ask about.
   *
   * Deliberately NOT `@VerifiedOnly()`: an unverified caller is precisely who
   * needs the answer, and refusing them here would leave the draft screen
   * unable to explain itself.
   */
  @Get('eligibility/:targetUserId')
  @UseGuards(JwtGuard)
  async getMessagingEligibility(
    @Req() req: AuthenticatedRequest,
    @Param('targetUserId') targetUserId: string,
  ) {
    const userId = req.user?.id;
    const map = await this.verificationAccess.getEligibilityMap([
      userId,
      targetUserId,
    ]);
    const selfEligible = map.get(userId) !== false;
    const targetEligible =
      !targetUserId || targetUserId === userId
        ? selfEligible
        : map.get(targetUserId) !== false;

    return {
      targetUserId,
      selfEligible,
      targetEligible,
      // First-year isolation has been removed. Kept, always `false`, because
      // installed apps ship a frozen frontend that may read it.
      messagingRestricted: false,
      canMessage: selfEligible && targetEligible,
    };
  }

  @Post()
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async startDM(
    @Req() req: AuthenticatedRequest,
    @Body('targetUserId') targetUserId?: string,
    @Body('userIds') userIdsBody?: string | string[],
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
    void this.domainEventService.emit(
      'conversation:updated',
      { conversationId: res.id },
      [targetId],
    );
    return res;
  }

  /**
   * Invites one person to a group, in one request.
   *
   * The invite modal used to find or create the DM first and then send the
   * card into it: two round trips per person. And for someone it had never
   * messaged it sent to a client-side "draft" id the send route cannot
   * resolve, so that invite failed outright ("Couldn't send invite").
   *
   * Here, in order: the group is checked and the card built from it
   * (buildGroupInvite: the inviter is still in it, it is open, the target is
   * not already in it) before anything is written; the DM is found or created
   * (startDM: blocks, eligibility, first-contact rate limit, per-pair lock);
   * and the card is sent through the same handler as any message (send rate
   * limit, idempotency by clientId, fan-out after the response).
   */
  @Post('invite')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async sendGroupInvite(
    @Req() req: AuthenticatedRequest,
    @Body() body: SendGroupInviteDto,
  ) {
    const userId = req.user?.id;
    const inviteData = await this.dmService.buildGroupInvite(
      body.groupId,
      userId,
      body.targetUserId,
    );
    const dm = await this.dmService.startDM(userId, body.targetUserId);
    const payload = Object.assign(new SendMessageDto(), {
      text: '',
      inviteData,
      ...(body.clientId ? { clientId: body.clientId } : {}),
    });
    return this.sendMessage(req, dm.id, payload);
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
    return this.dmService.getConversationHistory(
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
    const message = await this.dmService.sendMessage(
      userId,
      conversationId,
      body,
    );

    const unblockedParticipantIds = message.recipientIds || [];
    const unmutedRecipientIds = message.unmutedRecipientIds || [];
    const allParticipantIds = Array.from(
      new Set([userId, ...unblockedParticipantIds]),
    );

    const previewText = previewOf(message);

    setImmediate(() => {
      // Muted recipients still receive the message, flagged `alert: false`.
      emitMessageNew(this.domainEventService, message, {
        recipientIds: unblockedParticipantIds,
        unmutedRecipientIds,
        senderId: userId,
      }).forEach((p) => {
        void p.catch(() => {});
      });
      this.domainEventService
        .emit(
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
        )
        .catch(() => {});
      this.domainEventService
        .emit('message:new', { ...message, alert: false }, [userId])
        .catch(() => {});

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
              previewText,
            ),
          )
          .catch(() => {});
      }
    });

    return publicMessage(message);
  }

  @Post(':id/read')
  @UseGuards(JwtGuard)
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.dmService.markAsRead(conversationId, userId);
  }

  @Patch(':id/mute')
  @UseGuards(JwtGuard)
  async muteConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('muted') muted: boolean,
  ) {
    const userId = req.user?.id;
    return this.dmService.muteConversation(conversationId, userId, muted);
  }

  @Patch(':id/pin')
  @UseGuards(JwtGuard)
  async pinConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body('pinned') pinned: boolean,
  ) {
    const userId = req.user?.id;
    return this.dmService.pinConversation(conversationId, userId, pinned);
  }

  @Post(':id/clear')
  @UseGuards(JwtGuard)
  async clearChat(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.dmService.clearChatForUser(conversationId, userId);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async deleteConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const userId = req.user?.id;
    return this.dmService.deleteConversationForUser(conversationId, userId);
  }

  @Delete('msg/:messageId/for-me')
  @UseGuards(JwtGuard)
  async deleteMessageForMe(
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    const userId = req.user?.id;
    return this.dmService.deleteMessageForMe(messageId, userId);
  }

  @Delete('msg/:messageId')
  @UseGuards(JwtGuard)
  async unsendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    const userId = req.user?.id;
    const result = await this.dmService.unsendMessage(messageId, userId);
    // Only a change is announced: unsending twice is answered with success
    // (`changed: false`) and must not send every device the event again.
    announceUnsent(this.domainEventService, result);
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
    const result = await this.dmService.forwardMessage(
      messageId,
      targetConversationIds,
      userId,
    );

    if (result.messages && Array.isArray(result.messages)) {
      for (const message of result.messages) {
        const conversationId = message.conversationId;
        const participantIds =
          await this.dmService.getConversationParticipantIds(conversationId);
        const conv = await this.dmService.getConversationById(conversationId);

        const otherParticipantIds = participantIds.filter(
          (pId) => pId !== userId,
        );
        // Was an N+1 of isUserBlockedBy (one query per participant) against a
        // method that duplicated BlocksService. One cached call now answers for
        // the whole list, in both directions.
        const unblockedParticipantIds =
          await this.blocksService.filterBlockedUsers(
            userId,
            otherParticipantIds,
          );

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

        for (const pId of unblockedParticipantIds) {
          const isMuted = await this.dmService.isUserConversationMuted(
            conversationId,
            pId,
          );
          if (!isMuted) {
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
    return this.dmService.reactToMessage(messageId, userId, reaction);
  }
}
