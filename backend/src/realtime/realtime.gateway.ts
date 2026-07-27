import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../presence/presence.service';
import { InstantMatchService, setRealtimeGatewayRef, MatchFoundPayload, QueueStats } from '../instant-match/instant-match.service';
import { PrismaService } from '../prisma/prisma.service';
import { checkPresenceVisibility } from '../users/privacy.helper';
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('SOCKET');
  private readonly chatLogger = new Logger('CHAT');

  @WebSocketServer()
  server: Server;

  // We still keep the deviceId map for E2EE device-specific routing
  private connectedDevices = new Map<string, Socket>();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly messagesService: MessagesService,
    private readonly presenceService: PresenceService,
    private readonly instantMatchService: InstantMatchService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  afterInit() {
    // Register this gateway as the emit target for InstantMatchService
    setRealtimeGatewayRef(this);
    this.setupDomainEventSubscriber();
  }

  private setupDomainEventSubscriber() {
    const subClient = this.redisService.getSubClient();
    if (subClient) {
      subClient.subscribe('meetifyy:domain_events', (err) => {
        if (err) this.logger.error('Failed to subscribe to domain events', err);
      });
      subClient.on('message', (channel, message) => {
        if (channel === 'meetifyy:domain_events') {
          try {
            const payload = JSON.parse(message);
            this.handleDomainEvent(payload);
          } catch (e) {
            this.logger.error('Failed to parse domain event payload', e);
          }
        }
      });
    }
  }

  @OnEvent('**')
  handleLocalDomainEvent(payload: any) {
    if (payload && payload.type) {
      // Fallback for single instance or local dev without Redis Pub/Sub
      if (!this.redisService.getSubClient()) {
        this.handleDomainEvent(payload);
      }
    }
  }

  private handleDomainEvent(payload: any) {
    const isLegacyEvent = payload.type.includes(':');
    
    if (payload.targetUserIds && Array.isArray(payload.targetUserIds) && payload.targetUserIds.length > 0) {
      for (const targetId of payload.targetUserIds) {
        if (isLegacyEvent) {
          this.server.to(targetId).emit(payload.type, payload.data);
        } else {
          this.server.to(targetId).emit('domainEvent', payload);
        }
      }
    } else {
      // Never broadcast to all connected clients \u2014 this scales linearly with concurrent users.
      // If targetUserIds is empty/missing, the event has no intended recipient; drop it safely.
      this.logger.warn(`Domain event '${payload.type}' has no targetUserIds \u2014 dropped (not broadcast)`);
    }
  }


  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    const deviceId = client.handshake.auth?.deviceId;

    if (!token) {
      this.logger.warn(`Client connection rejected: missing token`);
      client.disconnect();
      return;
    }
    
    let userId: string = '';
    let userName: string = 'Unknown';

    if (!this.supabaseService.isConfigured) {
      this.logger.warn(`Client connection rejected: Supabase Auth not configured`);
      client.disconnect();
      return;
    }
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        const nowSec = Math.floor(Date.now() / 1000);
        if (payload && payload.sub && payload.exp && payload.exp > nowSec) {
          userId = payload.sub;
          userName = payload.user_metadata?.username || payload.user_metadata?.displayName || payload.email || 'Unknown';
        }
      }
    } catch {
      // Ignore parse error and fall back to Supabase remote check
    }

    if (!userId) {
      try {
        const { data: { user }, error } = await this.supabaseService.client.auth.getUser(token);
        if (error || !user) {
          this.logger.warn(`Client connection rejected: invalid token`);
          client.disconnect();
          return;
        }
        userId = user.id;
        userName = user.user_metadata?.username || user.user_metadata?.displayName || user.email || 'Unknown';
      } catch (err) {
        this.logger.error('WebSocket connection authentication check failed', err);
        client.disconnect();
        return;
      }
    }

    (client as any).userId = userId;
    (client as any).userName = userName;
    client.join(userId); // Join user's personal room for multiplexed broadcasting

    // Automatically join all active conversation rooms for O(1) broadcasting
    try {
      const activeConvs = await this.prisma.conversationParticipant.findMany({
        where: { userId, deletedAt: null, leftAt: null },
        select: { conversationId: true }
      });
      activeConvs.forEach(p => client.join(`conv_${p.conversationId}`));
    } catch (err) {
      this.logger.error('Failed to pre-join conversation rooms', err);
    }

    let resolvedDeviceName = 'unknown';

    if (deviceId) {
      (client as any).deviceId = deviceId;
      this.connectedDevices.set(deviceId, client);

      try {
        const deviceRecord = await this.prisma.device.findUnique({
          where: { id: deviceId },
          select: { deviceName: true, platform: true }
        });
        if (deviceRecord) {
          resolvedDeviceName = deviceRecord.deviceName || deviceRecord.platform || deviceId;
        }
      } catch (e) {
        // ignore
      }
    }

    await this.presenceService.setOnline(userId, client.id);
    this.server.emit('presence:update', {
      userId,
      status: 'online',
      lastActive: new Date().toISOString()
    });
    this.logger.log(`Connected user=${userId} socket=${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    const deviceId = (client as any).deviceId;
    
    if (userId) {
      await this.presenceService.setOffline(userId, client.id);
      const presence = await this.presenceService.getPresence(userId);
      if (!presence || presence.status === 'offline') {
        this.server.emit('presence:update', {
          userId,
          status: 'offline',
          lastActive: presence?.lastSeen || new Date().toISOString()
        });
      }
    }
    if (deviceId) {
      this.connectedDevices.delete(deviceId);
    }
    this.logger.log(`Disconnected user=${userId || 'unknown'} socket=${client.id}`);
  }

  @SubscribeMessage('presence:get')
  async handleGetPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string }
  ) {
    if (!data?.userId) return null;
    const viewerId = (client as any).userId;
    const targetUserId = data.userId;

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        settings: {
          select: {
            showOnlineStatus: true,
            whoCanSeeOnline: true
          }
        }
      }
    });

    const presence = await this.presenceService.getPresence(targetUserId);
    if (!targetUser) {
      return {
        userId: targetUserId,
        status: presence?.status || 'offline',
        lastActive: presence?.lastSeen || null
      };
    }
    const canSeeOnline = await checkPresenceVisibility(
      targetUserId,
      viewerId,
      targetUser.settings?.whoCanSeeOnline || 'everyone',
      targetUser.settings?.showOnlineStatus !== false,
      this.prisma
    );

    return {
      userId: targetUserId,
      status: canSeeOnline ? (presence?.status || 'offline') : 'offline',
      lastActive: presence?.lastSeen || null
    };
  }

  // E2EE Chat Message Routing (migrated from chat.gateway.ts)
  // Re-aliasing to 'sendEncryptedMessage' for backwards compatibility with older client for now
  @SubscribeMessage('sendEncryptedMessage')
  async handleEncryptedMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; targets: Array<{deviceId: string, type: number, ciphertext: string}> }
  ) {
    const senderId = (client as any).userId;
    const senderDeviceId = (client as any).deviceId;
    this.chatLogger.log(`Message Sent chat=${data.conversationId} targets=${data.targets.length}`);

    try {
      // 1. Save in Database
      const message = await this.messagesService.saveEncryptedMessage(
        senderId,
        senderDeviceId,
        data.conversationId,
        data.targets
      );

      // 2. Route directly to connected devices
      for (const target of data.targets) {
        const targetSocket = this.connectedDevices.get(target.deviceId);
        if (targetSocket) {
          targetSocket.emit('receiveEncryptedMessage', {
            id: message.id,
            conversationId: data.conversationId,
            sender: { id: senderId }, 
            senderDeviceId,
            type: target.type,
            ciphertext: target.ciphertext,
            createdAt: message.createdAt
          });
        }
      }
      
      return { status: 'ok', messageId: message.id };
    } catch (error) {
      this.chatLogger.error(`Failed to process message chat=${data.conversationId}`);
      client.emit('messageError', { error: 'Failed to process message' });
      return { status: 'error', error: 'Failed to process message' };
    }
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tempId?: string; conversationId: string; text?: string; mediaUrl?: string; mediaType?: string; mentions?: string[]; replyToId?: string; inviteData?: any }
  ) {
    const senderId = (client as any).userId;
    if (!senderId) return { status: 'error', error: 'Unauthenticated' };
    try {
      const message = await this.messagesService.sendMessage(senderId, data.conversationId, data);
      const payload = { ...message, tempId: data.tempId, status: 'sent' };
      await this.emitToConversation(data.conversationId, 'message:new', payload);
      return { status: 'ok', tempId: data.tempId, message: payload };
    } catch (err: any) {
      return { status: 'error', tempId: data.tempId, error: err.message || 'Failed to send message' };
    }
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string }
  ) {
    const userId = (client as any).userId;
    const userName = (client as any).userName || 'Someone';
    if (!userId || !data?.conversationId) return;
    await this.emitToConversation(data.conversationId, 'typing:start', {
      conversationId: data.conversationId,
      userId,
      userName,
    });
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string }
  ) {
    const userId = (client as any).userId;
    if (!userId || !data?.conversationId) return;
    await this.emitToConversation(data.conversationId, 'typing:stop', {
      conversationId: data.conversationId,
      userId,
    });
  }

  @SubscribeMessage('message:received')
  @SubscribeMessage('message:delivered')
  async handleMessageDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; messageId: string }
  ) {
    const userId = (client as any).userId;
    if (!userId || !data?.conversationId || !data?.messageId) return;
    const deliveredAt = new Date().toISOString();
    await this.emitToConversation(data.conversationId, 'message:delivered', {
      conversationId: data.conversationId,
      messageId: data.messageId,
      deliveredTo: userId,
      deliveredAt,
    });
  }

  @SubscribeMessage('presence:get_status')
  async handlePresenceGetStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userIds: string[] }
  ) {
    if (!data?.userIds || !Array.isArray(data.userIds)) return { status: 'error' };
    const presenceMap = await this.presenceService.getPresenceMany(data.userIds);
    const result: Record<string, any> = {};
    presenceMap.forEach((val, key) => {
      result[key] = { status: val.status, lastSeen: val.lastSeen };
    });
    return { status: 'ok', presence: result };
  }

  @SubscribeMessage('messages:seen')
  @SubscribeMessage('conversation:mark_seen')
  async handleConversationSeen(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; lastMessageId?: string }
  ) {
    const readerId = (client as any).userId;
    if (!readerId || !data?.conversationId) return;
    
    await this.messagesService.markAsRead(data.conversationId, readerId);
    const lastReadAt = new Date().toISOString();
    
    const payload = {
      conversationId: data.conversationId,
      lastMessageId: data.lastMessageId,
      readerId,
      lastReadAt,
    };

    this.emitToConversation(data.conversationId, 'messages:seen', payload);
    this.emitToConversation(data.conversationId, 'conversation:seen', payload);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    return { event: 'pong', timestamp: Date.now() };
  }


  // --- API for other modules to emit events ---

  emitNotification(userId: string, notification: any) {
    this.server.to(userId).emit('notification:new', {
      id: notification.id,
      type: notification.type,
      entityType: notification.entityType,
      entityId: notification.entityId,
      title: notification.title,
      body: notification.body,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      actor: notification.actor || null,
      metadata: notification.metadata || null,
    });
  }

  emitUnreadCount(userId: string, count: number) {
    this.server.to(userId).emit('notification:count', { count });
  }

  /**
   * Emit an event to all participants of a conversation using O(1) Socket.io rooms.
   * Resolves both DB ID and Public ID aliases so all participants receive real-time events.
   */
  async emitToConversation(conversationId: string, event: string, payload: any) {
    if (!conversationId) return;
    this.server.to(`conv_${conversationId}`).emit(event, payload);

    try {
      const conv = await this.prisma.conversation.findFirst({
        where: { OR: [{ id: conversationId }, { publicId: conversationId }] },
        select: { id: true, publicId: true }
      });
      if (conv) {
        if (conv.id && conv.id !== conversationId) {
          this.server.to(`conv_${conv.id}`).emit(event, payload);
        }
        if (conv.publicId && conv.publicId !== conversationId) {
          this.server.to(`conv_${conv.publicId}`).emit(event, payload);
        }
      }
    } catch {
      // Ignore lookup error
    }
  }

  @SubscribeMessage('conversation:join_rooms')
  handleJoinRooms(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationIds: string[] }
  ) {
    if (data?.conversationIds && Array.isArray(data.conversationIds)) {
      data.conversationIds.forEach(id => client.join(`conv_${id}`));
    }
  }


  // ─── Instant Match Socket Handlers ──────────────────────────────────────────

  @SubscribeMessage('queue:join')
  async handleQueueJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const userId = (client as any).userId;
    if (!userId) return { status: 'error', error: 'Unauthenticated' };
    try {
      await this.instantMatchService.joinQueue({
        userId,
        campus: data.campus || 'unknown',
        activity: data.activity,
        timePreference: data.timePreference,
        optionalDetail: data.optionalDetail,
        location: data.location,
      });
      return { status: 'ok' };
    } catch (err) {
      this.logger.error('queue:join error', err);
      return { status: 'error', error: 'Failed to join queue' };
    }
  }

  @SubscribeMessage('queue:cancel')
  async handleQueueCancel(@ConnectedSocket() client: Socket) {
    const userId = (client as any).userId;
    if (!userId) return { status: 'error', error: 'Unauthenticated' };
    try {
      await this.instantMatchService.cancelQueue(userId);
      return { status: 'ok' };
    } catch (err) {
      this.logger.error('queue:cancel error', err);
      return { status: 'error', error: 'Failed to cancel queue' };
    }
  }

  @SubscribeMessage('match:respond')
  async handleMatchRespond(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string; action: 'accept' | 'decline' },
  ) {
    const userId = (client as any).userId;
    if (!userId) return { status: 'error', error: 'Unauthenticated' };
    try {
      await this.instantMatchService.respondToMatch(userId, data.matchId, data.action);
      return { status: 'ok' };
    } catch (err) {
      this.logger.error('match:respond error', err);
      return { status: 'error', error: 'Failed to respond to match' };
    }
  }

  // ─── Instant Match Emit Helpers ──────────────────────────────────────────────

  emitMatchFound(userId: string, payload: MatchFoundPayload) {
    this.server.to(userId).emit('match:found', payload);
  }

  emitMatchAccepted(userId: string, payload: { chatId: string }) {
    this.server.to(userId).emit('match:accepted', payload);
  }

  emitMatchDeclined(userId: string, payload: { reason: string }) {
    this.server.to(userId).emit('match:declined', payload);
  }

  emitSearchResumed(userId: string) {
    this.server.to(userId).emit('search:resumed', {});
  }

  emitQueueStats(userId: string, stats: QueueStats) {
    this.server.to(userId).emit('queue:stats', stats);
  }
}
