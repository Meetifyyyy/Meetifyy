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
  Optional,
} from '@nestjs/common';
import { requestedUserIds } from './core/requested-user-ids';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { MessagesService } from './messages.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import { DomainEventService } from '../events/domain-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { SendMessageDto } from './core/dto/send-message.dto';
import { emitMessageNew, publicMessage } from './message-alert.util';
import { UpdateGroupSettingsDto } from './dto/update-group-settings.dto';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { announceUnsent } from './unsend-announce.util';
import {
  announceJoinRequested,
  announceJoined,
  announceRequestApproved,
  announceRequestDeclined,
  GroupAnnouncer,
} from './group-join-announce.util';
import { previewOf } from './core/message-preview';
import {
  announceDeparture,
  type DepartureAnnouncer,
} from './group-departure-announce.util';
import { JoinGroupDto } from './core/dto/join-group.dto';
import { inviteRefFromQuery } from './core/group-invite-access';
import { PushDispatcherService } from '../push/push-dispatcher.service';

@Controller('api/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly domainEventService: DomainEventService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
    // Optional so a build without push (and tests) construct without it.
    @Optional() private readonly pushDispatcher?: PushDispatcherService,
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
        // `senderId` syncs it back to the sender's own devices too — without
        // it, a message sent over HTTP reaches everyone except the person who
        // sent it. See message-alert.util.ts.
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
            // Lets clients skip a conversation that has no row in the Messages
            // list at all, instead of reading its absence as a stale cache.
            chatType: message.chatType || 'normal',
            isInstantMatch: Boolean(message.isInstantMatch),
            lastMessage: {
              id: message.id,
              text: previewOf(message),
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
        void this.domainEventService.emit(
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
  // `eligibleOnly=true` is sent by Share/Forward pickers and never by the
  // inbox. See getUserConversations for why one endpoint answers both.
  async getConversations(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('eligibleOnly') eligibleOnly?: string,
    @Query('search') search?: string,
  ) {
    const userId = req.user?.id;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const limitNum = isNaN(parsedLimit) ? 20 : parsedLimit;
    const offsetNum = isNaN(parsedOffset) ? 0 : parsedOffset;
    // Capped so a pathological query string cannot become the cache key or a
    // very wide `contains` scan. Longer input is truncated, not rejected: the
    // extra characters could only have narrowed the result further.
    const searchTerm = (typeof search === 'string' ? search : '').slice(0, 100);
    return this.messagesService.getUserConversations(
      userId,
      limitNum,
      offsetNum,
      eligibleOnly === 'true',
      searchTerm,
    );
  }

  // Declared before `:conversationId`, which would otherwise take the path.
  @Get('unread-summary')
  @UseGuards(JwtGuard)
  getUnreadSummary(@Req() req: AuthenticatedRequest) {
    return this.messagesService.getUnreadSummary(req.user.id);
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

  /**
   * The conversation's shared photos and videos, newest first, paged by
   * `before` (the previous page's `nextCursor`). The contact-details gallery
   * reads this instead of deriving media from the history pages it holds.
   */
  @Get(':conversationId/media')
  @UseGuards(JwtGuard)
  async getMedia(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Query('before') beforeCursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.messagesService.getConversationMedia(
      conversationId,
      req.user.id,
      beforeCursor,
      parsedLimit,
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
        chatType: message.chatType || 'normal',
        isInstantMatch: Boolean(message.isInstantMatch),
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

    return publicMessage(message);
  }

  @Post()
  @Idempotent()
  @UseGuards(JwtGuard)
  async startConversation(
    @Req() req: AuthenticatedRequest,
    @Query('userIds') userIdsQuery?: string,
    @Body('userIds') userIdsBody?: unknown,
    @Body('name') nameBody?: string,
  ) {
    const userId = req.user?.id;
    let targetUserIds: string[] = [];
    if (userIdsBody) {
      targetUserIds = requestedUserIds(userIdsBody);
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
        void this.domainEventService.emit(
          'group:member_added',
          { conversationId: res.id, userId },
          others,
        );
        void this.domainEventService.emit(
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
        void this.domainEventService.emit(
          'group:role_changed',
          { conversationId, targetUserId, newRole },
          participantIds,
        );
      }
    } catch {
      // Never let a realtime emit fail the mutation that already committed.
    }
  }

  /** What the join and request announcements need from this controller. */
  private get departures(): DepartureAnnouncer {
    return {
      events: this.domainEventService,
      participantIds: (id) =>
        this.messagesService.getConversationParticipantIds(id),
      userHandle: (id) => this.messagesService.getUserHandle(id),
      systemLine: (id, actorId, text, options) =>
        this.messagesService.createSystemMessage(id, actorId, text, options),
    };
  }

  private get announcer(): GroupAnnouncer {
    return {
      events: this.domainEventService,
      push: this.pushDispatcher,
      participantIds: (id) =>
        this.messagesService.getConversationParticipantIds(id),
      reviewerIds: (id) => this.messagesService.getGroupReviewerIds(id),
      userHandle: (id) => this.messagesService.getUserHandle(id),
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
      const message = await this.messagesService.createSystemMessage(
        conversationId,
        senderId,
        text,
      );
      const participantIds =
        await this.messagesService.getConversationParticipantIds(
          conversationId,
        );
      void this.domainEventService.emit('message:new', message, participantIds);
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
      const avatarVal = result.avatarKey || null;
      void this.domainEventService.emit(
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
      avatar: result.avatarKey || null,
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
    // Already in the group: nothing changed, so nothing to announce.
    if (result.alreadyMember) return result;
    const actorHandle = await this.messagesService.getUserHandle(userId);
    const targetHandle = await this.messagesService.getUserHandle(targetUserId);
    await this.broadcastSystemMessage(
      conversationId,
      userId,
      `${actorHandle} added ${targetHandle} to the group`,
    );

    const memberIds =
      await this.messagesService.getConversationParticipantIds(conversationId);
    void this.domainEventService.emit(
      'group:member_added',
      {
        conversationId,
        internalId: result.internalId,
        userId: targetUserId,
        membershipChangedAt: result.joinedAt,
      },
      [...new Set([targetUserId, ...memberIds])],
    );
    void this.domainEventService.emit(
      'conversation:updated',
      { conversationId },
      [targetUserId],
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
    // Mutate FIRST — if removal is rejected (not admin, target is owner, etc.)
    // we must not persist/broadcast an "X removed Y" system message.
    const result = await this.messagesService.removeGroupMember(
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
    // Mutate FIRST so a failed leave never leaves an orphan "X left" message.
    const result = await this.messagesService.leaveGroup(
      conversationId,
      userId,
    );
    // Already gone: a double tap must not post "X left the group" twice.
    if (!result.changed || !result.internalId || !result.leftAt) return result;

    announceDeparture(
      this.departures,
      {
        internalId: result.internalId,
        publicId: result.publicId || result.internalId,
        leftAt: result.leftAt,
      },
      { actorId: userId, targetUserId: userId },
    );

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
      void this.domainEventService.emit(
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
    // endGroup verifies ownership; announce only after it succeeds.
    const result = await this.messagesService.endGroup(conversationId, userId);
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
    const result = await this.messagesService.acceptGroupJoinRequest(
      conversationId,
      userId,
      targetUserId,
    );
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
    const result = await this.messagesService.declineGroupJoinRequest(
      conversationId,
      userId,
      targetUserId,
    );
    if (result.changed)
      announceRequestDeclined(this.announcer, result, targetUserId);
    return result;
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
    const result = await this.messagesService.joinGroupByInvite(
      conversationId,
      userId,
      { code: body?.code, messageId: body?.messageId },
    );
    if (result.status === 'PENDING') {
      if (result.newRequest)
        announceJoinRequested(this.announcer, result, userId);
      return result;
    }
    if (!result.alreadyMember) {
      // Before replying, so the joiner's list refetch is not answered from a
      // cache that predates the join; the announcements after it.
      await this.messagesService
        .evictMembershipCaches(result.internalId, [userId])
        .catch(() => {});
      announceJoined(this.announcer, result, userId);
    }
    return result;
  }

  @Post(':id/request')
  @UseGuards(JwtGuard)
  @VerifiedOnly()
  async requestJoinGroup(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: JoinGroupDto = {},
  ) {
    // Identical semantics to :id/join — the invite card has always posted here.
    return this.joinGroup(req, conversationId, body);
  }

  @Get(':id/invite')
  @UseGuards(JwtGuard)
  async getInvitePreview(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Query('code') code?: string,
    @Query('messageId') messageId?: string,
  ) {
    return this.messagesService.getGroupInvitePreview(
      conversationId,
      req.user?.id,
      inviteRefFromQuery(code, messageId),
    );
  }
}
