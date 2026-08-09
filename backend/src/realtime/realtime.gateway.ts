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
import { checkPresenceVisibility, checkPresenceVisibilityBatch } from '../users/privacy.helper';
import { RedisService } from '../redis/redis.service';
import { MentionDto } from '../common/dto/mention.dto';

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


  // In-memory alias cache: conversationId (any form) → { id, publicId }
  // Avoids a Prisma round-trip on every emitToConversation call (e.g. typing events)
  private convAliasCache = new Map<string, { id: string; publicId: string | null; cachedAt: number }>();
  private readonly ALIAS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Cache target user presence settings to avoid database queries on getPresence events
  private userPresenceSettingsCache = new Map<string, { settings: any; cachedAt: number }>();
  private readonly PRESENCE_SETTINGS_TTL_MS = 60 * 1000; // 60 seconds

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
    this.presenceService.registerSocketValidator((socketId: string) => {
      const s = this.server?.sockets?.sockets?.get(socketId);
      return Boolean(s && s.connected);
    });

    this.presenceService.onStatusChange(async (userId, status, lastSeen) => {
      await this.broadcastPresenceUpdate(userId, status, lastSeen);
    });

    this.setupDomainEventSubscriber();
  }

  private async broadcastPresenceUpdate(userId: string, status: string, lastSeen: string) {
    const presencePayload = { userId, status, lastActive: lastSeen };
    
    try {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { settings: { select: { showOnlineStatus: true, whoCanSeeOnline: true } } }
      });
      const rule = targetUser?.settings?.whoCanSeeOnline || 'everyone';
      const isEnabled = targetUser?.settings?.showOnlineStatus !== false;

      // Always broadcast to the user's personal room (for multi-device sync)
      this.server.to(userId).emit('presence:update', presencePayload);

      if (!isEnabled || rule === 'nobody') {
        return; // Already emitted to self
      }

      if (rule === 'everyone') {
        const userConvs = await this.prisma.conversationParticipant.findMany({
          where: { userId, deletedAt: null, leftAt: null },
          select: { conversationId: true }
        });
        userConvs.forEach(p => {
          if (p.conversationId) {
            this.server.to(`conv_${p.conversationId}`).emit('presence:update', presencePayload);
          }
        });
        return;
      }

      // Restrictive rules: following or mutual
      // Find all unique users in shared conversations
      const sharedConvs = await this.prisma.conversationParticipant.findMany({
        where: { 
          conversation: { participants: { some: { userId: userId, deletedAt: null, leftAt: null } } }, 
          deletedAt: null, leftAt: null 
        },
        select: { userId: true }
      });
      const uniqueViewerIds = [...new Set(sharedConvs.map(p => p.userId).filter(id => id !== userId))];

      if (uniqueViewerIds.length > 0) {
        const allowedViewerIds = await checkPresenceVisibilityBatch(userId, uniqueViewerIds, rule, isEnabled, this.prisma);
        if (allowedViewerIds.length > 0) {
          this.server.to(allowedViewerIds).emit('presence:update', presencePayload);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to broadcast presence update for user=${userId}`, err);
    }
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
    if (payload.type === 'user.settings_updated') {
      const uId = payload.targetUserId || payload.data?.userId;
      if (uId) {
        this.userPresenceSettingsCache.delete(uId);
        
        // Always force broadcast offline to all group rooms so clients immediately hide the status
        const offlinePayload = { userId: uId, status: 'offline', lastActive: new Date().toISOString() };
        this.prisma.conversationParticipant.findMany({
          where: { userId: uId, deletedAt: null, leftAt: null },
          select: { conversationId: true }
        }).then(userConvs => {
          userConvs.forEach(c => {
            if (c.conversationId) this.server.to(`conv_${c.conversationId}`).emit('presence:update', offlinePayload);
          });
        }).catch(() => {});

        // Re-evaluate and broadcast true status based on new rules
        this.presenceService.getPresence(uId).then(presence => {
          const status = presence?.status || 'offline';
          const lastSeen = presence?.lastSeen || new Date().toISOString();
          this.broadcastPresenceUpdate(uId, status, lastSeen);
        }).catch(() => {});
      }
    }

    if (payload.type === 'group:member_added') {
      const convId = payload.data?.conversationId || payload.conversationId;
      const targetUser = payload.data?.userId || payload.userId;
      if (convId && targetUser) {
        const userSockets = this.server.sockets.adapter.rooms.get(targetUser);
        if (userSockets) {
          userSockets.forEach(socketId => {
            const socket = this.server.sockets.sockets.get(socketId);
            if (socket) socket.join(`conv_${convId}`);
          });
        }
      }
    }

    if (payload.type === 'group:member_removed') {
      const convId = payload.data?.conversationId || payload.conversationId;
      const targetUser = payload.data?.targetUserId || payload.targetUserId || payload.data?.userId;
      if (convId && targetUser) {
        const userSockets = this.server.sockets.adapter.rooms.get(targetUser);
        if (userSockets) {
          userSockets.forEach(socketId => {
            const socket = this.server.sockets.sockets.get(socketId);
            if (socket) socket.leave(`conv_${convId}`);
          });
        }
      }
    }

    // Post-scoped realtime: fan comment/like/poll/deletion activity out to
    // everyone currently viewing the post (they joined `post_<id>` via
    // 'post:join'). This is IN ADDITION to any per-user target routing below —
    // the client handlers are idempotent (absolute counts, id-deduped inserts,
    // self-actor guards), so a viewer who is also a per-user target harmlessly
    // applies the same patch twice.
    const postScopeId = payload.data?.postId || payload.postId;
    if (postScopeId && RealtimeGateway.POST_ROOM_EVENTS.has(payload.type)) {
      this.server.to(`post_${postScopeId}`).emit('domainEvent', payload);
    }

    const isLegacyEvent = payload.type?.includes(':');
    let targets: string[] = [];

    const commId = payload.communityId || payload.data?.communityId;
    if (commId) {
      this.server.to(`community_${commId}`).emit('community:memberCount', payload.data || payload);
      this.server.to(`community_${commId}`).emit('community:updated', payload.data || payload);
      this.server.to(`community_${commId}`).emit('domainEvent', payload);
      this.server.emit('community:updated', payload.data || payload);
    }

    if (Array.isArray(payload.targetUserIds) && payload.targetUserIds.length > 0) {
      targets = payload.targetUserIds;
    } else if (payload.targetUserId) {
      targets = [payload.targetUserId];
    } else if (payload.data?.targetUserId) {
      targets = [payload.data.targetUserId];
    } else if (payload.conversationId || payload.data?.conversationId) {
      const convId = payload.conversationId || payload.data?.conversationId;
      this.server.to(`conv_${convId}`).emit(isLegacyEvent ? payload.type : 'domainEvent', payload.data || payload);
      return;
    }

    if (targets.length > 0) {
      for (const targetId of targets) {
        if (isLegacyEvent) {
          this.server.to(targetId).emit(payload.type, payload.data);
        } else {
          this.server.to(targetId).emit('domainEvent', payload);
        }
      }
    } else if (!commId) {
      this.logger.warn(`Domain event '${payload.type}' has no valid targetUserIds/room — dropped safely`);
    }
  }


  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;

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
        select: {
          conversationId: true,
          conversation: { select: { publicId: true } }
        }
      });
      activeConvs.forEach(p => {
        if (p.conversationId) client.join(`conv_${p.conversationId}`);
        if (p.conversation?.publicId) client.join(`conv_${p.conversation.publicId}`);
      });
    } catch (err) {
      this.logger.error('Failed to pre-join conversation rooms', err);
    }


    await this.presenceService.setOnline(userId, client.id);

    this.logger.log(`Connected user=${userId} socket=${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    
    if (userId) {
      let userConvIds: string[] = [];
      try {
        const userConvs = await this.prisma.conversationParticipant.findMany({
          where: { userId, deletedAt: null, leftAt: null },
          select: { conversationId: true }
        });
        userConvIds = userConvs.map(p => p.conversationId).filter(Boolean);
      } catch (err) {
        this.logger.error('Failed to fetch conversation rooms on disconnect', err);
      }

      userConvIds.forEach(cId => {
        this.server.to(`conv_${cId}`).emit('typing:stop', { conversationId: cId, userId });
      });

      await this.presenceService.setOffline(userId, client.id);
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

    let targetUser: any;
    const now = Date.now();
    const cachedSettings = this.userPresenceSettingsCache.get(targetUserId);
    if (cachedSettings && (now - cachedSettings.cachedAt < this.PRESENCE_SETTINGS_TTL_MS)) {
      targetUser = cachedSettings.settings;
    } else {
      targetUser = await this.prisma.user.findUnique({
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
      if (targetUser) {
        this.userPresenceSettingsCache.set(targetUserId, { settings: targetUser, cachedAt: now });
      }
    }

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
      lastActive: presence?.lastSeen || null,
      lastSeen: presence?.lastSeen || null
    };
  }

  @SubscribeMessage('presence:heartbeat')
  async handlePresenceHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = (client as any).userId;
    if (!userId) return { status: 'error', error: 'Unauthenticated' };
    await this.presenceService.setOnline(userId, client.id);
    return { status: 'ok', timestamp: Date.now() };
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tempId?: string; clientId?: string; conversationId: string; text?: string; mediaUrl?: string; mediaType?: string; mentions?: MentionDto[]; replyToId?: string; inviteData?: any }
  ) {
    const senderId = (client as any).userId;
    if (!senderId) return { status: 'error', error: 'Unauthenticated' };
    try {
      const message = await this.messagesService.sendMessage(senderId, data.conversationId, data);
      const clientKey = data.clientId || data.tempId;
      const payload = { ...message, tempId: clientKey, clientId: clientKey, status: 'sent' };

      // Broadcast to room excluding the sending socket to avoid duplicate websocket echo
      const room = `conv_${data.conversationId}`;
      client.to(room).emit('message:new', payload);
      // Multi-device sync: emit to sender's other connected sockets/tabs
      client.to(senderId).emit('message:new', payload);

      // Return server ACK directly to sending client callback
      return { status: 'ok', tempId: clientKey, clientId: clientKey, message: payload };
    } catch (err: any) {
      const clientKey = data.clientId || data.tempId;
      return { status: 'error', tempId: clientKey, clientId: clientKey, error: err.message || 'Failed to send message' };
    }
  }

  @SubscribeMessage('message:catchup')
  async handleMessageCatchup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { since: string }
  ) {
    const userId = (client as any).userId;
    if (!userId || !data?.since) return { status: 'error', error: 'Invalid parameters' };

    try {
      const messages = await this.messagesService.getCatchupMessages(userId, data.since);
      return { status: 'ok', messages };
    } catch (err: any) {
      return { status: 'error', error: err.message || 'Failed to fetch catchup messages' };
    }
  }

  // Realtime event types that fan out to a `post_<id>` room (everyone viewing
  // the post), not just per-user targets. Kept idempotent on the client.
  private static readonly POST_ROOM_EVENTS = new Set([
    'comment.created',
    'comment.deleted',
    'comment.liked',
    'comment.unliked',
    'post.pollVoted',
    'post.liked',
    'post.unliked',
    'post.deleted',
  ]);

  // A client viewing a post joins its room so it receives live comment/like/poll
  // activity; it leaves on unmount. Rooms are per-socket and auto-cleaned on
  // disconnect, so a missed 'post:leave' can't leak.
  @SubscribeMessage('post:join')
  handlePostJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId?: string }
  ) {
    const userId = (client as any).userId;
    if (!userId || !data?.postId) return;
    client.join(`post_${data.postId}`);
  }

  @SubscribeMessage('post:leave')
  handlePostLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId?: string }
  ) {
    if (!data?.postId) return;
    client.leave(`post_${data.postId}`);
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
  async handleMessageReceived(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; messageId: string }
  ) {
    // message:received is an alias for message:delivered — same handler logic
    return this.handleMessageDeliveredInternal(client, data);
  }

  @SubscribeMessage('message:delivered')
  async handleMessageDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; messageId: string }
  ) {
    return this.handleMessageDeliveredInternal(client, data);
  }

  private async handleMessageDeliveredInternal(
    client: Socket,
    data: { conversationId: string; messageId: string }
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
    const viewerId = (client as any).userId;
    const presenceMap = await this.presenceService.getPresenceMany(data.userIds);

    const now = Date.now();
    const uncachedUserIds = data.userIds.filter(id => {
      const cached = this.userPresenceSettingsCache.get(id);
      return !cached || (now - cached.cachedAt >= this.PRESENCE_SETTINGS_TTL_MS);
    });

    if (uncachedUserIds.length > 0) {
      const targetUsers = await this.prisma.user.findMany({
        where: { id: { in: uncachedUserIds } },
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
      targetUsers.forEach(u => this.userPresenceSettingsCache.set(u.id, { settings: u, cachedAt: now }));
    }

    const userMap = new Map<string, any>();
    data.userIds.forEach(uId => {
      const cached = this.userPresenceSettingsCache.get(uId);
      if (cached) userMap.set(uId, cached.settings);
    });

    const result: Record<string, any> = {};
    for (const uId of data.userIds) {
      const val = presenceMap.get(uId);
      const targetUser = userMap.get(uId);

      let canSeeOnline = true;
      if (targetUser) {
        canSeeOnline = await checkPresenceVisibility(
          uId,
          viewerId,
          targetUser.settings?.whoCanSeeOnline || 'everyone',
          targetUser.settings?.showOnlineStatus !== false,
          this.prisma
        );
      }

      result[uId] = {
        status: canSeeOnline ? (val?.status || 'offline') : 'offline',
        lastActive: val?.lastSeen || null,
        lastSeen: val?.lastSeen || null
      };
    }

    return { status: 'ok', presence: result };
  }

  @SubscribeMessage('messages:seen')
  async handleMessagesSeen(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; lastMessageId?: string }
  ) {
    return this.handleSeenInternal(client, data);
  }

  @SubscribeMessage('conversation:mark_seen')
  async handleMarkSeen(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; lastMessageId?: string }
  ) {
    return this.handleSeenInternal(client, data);
  }

  private async handleSeenInternal(
    client: Socket,
    data: { conversationId: string; lastMessageId?: string }
  ) {
    try {
      const readerId = (client as any).userId;
      if (!readerId || !data?.conversationId) return;

      // Single DB write regardless of which event name the client used
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
    } catch (e) {
      // Ignore transient pool timeouts or seen processing failures
    }
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
   * Resolves both DB ID and Public ID aliases — uses in-memory cache to avoid a
   * DB query on every typing keystroke or high-frequency event.
   */
  async emitToConversation(conversationId: string, event: string, payload: any) {
    if (!conversationId) return;
    this.server.to(`conv_${conversationId}`).emit(event, payload);

    try {
      // Check in-memory alias cache first
      const now = Date.now();
      const cached = this.convAliasCache.get(conversationId);
      let conv: { id: string; publicId: string | null } | null = null;

      if (cached && (now - cached.cachedAt) < this.ALIAS_CACHE_TTL_MS) {
        conv = { id: cached.id, publicId: cached.publicId };
      } else {
        const dbConv = await this.prisma.conversation.findFirst({
          where: { OR: [{ id: conversationId }, { publicId: conversationId }] },
          select: { id: true, publicId: true }
        });
        if (dbConv) {
          conv = dbConv;
          // Cache both directions so either alias hits the cache
          this.convAliasCache.set(dbConv.id, { id: dbConv.id, publicId: dbConv.publicId, cachedAt: now });
          if (dbConv.publicId) {
            this.convAliasCache.set(dbConv.publicId, { id: dbConv.id, publicId: dbConv.publicId, cachedAt: now });
          }
        }
      }

      if (conv) {
        if (conv.id && conv.id !== conversationId) {
          this.server.to(`conv_${conv.id}`).emit(event, payload);
        }
        if (conv.publicId && conv.publicId !== conversationId) {
          this.server.to(`conv_${conv.publicId}`).emit(event, payload);
        }
      }
    } catch {
      // Ignore lookup error — primary emit already fired above
    }
  }

  @SubscribeMessage('conversation:join_rooms')
  async handleJoinRooms(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationIds: string[] }
  ) {
    const userId = (client as any).userId;
    if (!userId || !data?.conversationIds || !Array.isArray(data.conversationIds)) return;

    // Skip DB lookup if client is already joined to all requested rooms
    const unjoinedIds = data.conversationIds.filter(id => id && !client.rooms.has(`conv_${id}`));
    if (unjoinedIds.length === 0) return;

    try {
      // Step 1: Indexed lookup on Conversation (id PK and publicId unique index)
      const matchingConvs = await this.prisma.conversation.findMany({
        where: {
          OR: [
            { id: { in: unjoinedIds } },
            { publicId: { in: unjoinedIds } }
          ]
        },
        select: { id: true, publicId: true }
      });

      if (matchingConvs.length === 0) return;

      const validInternalIds = new Set(matchingConvs.map(c => c.id));

      // Step 2: Fast indexed lookup on ConversationParticipant by (userId, conversationId)
      const validParticipants = await this.prisma.conversationParticipant.findMany({
        where: {
          userId,
          conversationId: { in: Array.from(validInternalIds) },
          deletedAt: null,
          leftAt: null
        },
        select: { conversationId: true }
      });

      const allowedInternalIds = new Set(validParticipants.map(p => p.conversationId));

      matchingConvs.forEach(c => {
        if (allowedInternalIds.has(c.id)) {
          if (c.id) client.join(`conv_${c.id}`);
          if (c.publicId) client.join(`conv_${c.publicId}`);
        }
      });
    } catch (err) {
      this.logger.error('Failed to verify room join authorization', err);
    }
  }

  @SubscribeMessage('community:join_room')
  handleJoinCommunityRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { communityId: string }
  ) {
    if (data?.communityId) {
      client.join(`community_${data.communityId}`);
    }
  }

  @SubscribeMessage('community:leave_room')
  handleLeaveCommunityRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { communityId: string }
  ) {
    if (data?.communityId) {
      client.leave(`community_${data.communityId}`);
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
