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
import type { IncomingHttpHeaders } from 'http';
import type { AppServer, AppSocket } from './socket-types';
import { Logger, Optional, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../presence/presence.service';
import {
  USER_ACCESS_COOKIE,
  USER_SESSION_ID_COOKIE,
} from '../auth/session/user-session-cookies';
import { BlocksService } from '../users/blocks.service';
import {
  InstantMatchService,
  setRealtimeGatewayRef,
  InstantMatchChatState,
  MatchAcceptedPayload,
  MatchFoundPayload,
  QueueStats,
} from '../instant-match/instant-match.service';
import { InstantMatchRateLimiter } from '../instant-match/instant-match.rate-limiter';
import {
  parseJoinQueuePayload,
  parseMatchRespondPayload,
} from '../instant-match/dto/join-queue.dto';
import { PrismaService } from '../prisma/prisma.service';
import { checkPresenceVisibilityBatch } from '../users/privacy.helper';
import { RedisService } from '../redis/redis.service';
import { CommunitiesService } from '../communities/communities.service';
import { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { StudentYearPolicyService } from '../common/student-year/student-year-policy.service';
import { LegalConsentService } from '../common/legal/legal-consent.service';
import { LEGAL_ACKNOWLEDGEMENT_REQUIRED_CODE } from '../common/legal/legal.constants';
import { socketCorsOrigin } from './socket-cors';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { RATE_LIMIT_POLICIES } from '../config/rate-limit.config';
import { config } from '../config';
import { normalizeIp } from '../common/rate-limit/client-ip.util';
import type { RateLimitPolicyName } from '../config/rate-limit.config';
import { detach } from '../common/utils/detach.util';
import { errorMessage } from '../common/utils/error.util';
import { isRecord } from '../common/utils/type-guards.util';
import {
  ConversationRefPayload,
  DeliveryReceiptPayload,
  SeenPayload,
  SocketSendMessagePayload,
  correlationIdOf,
  parseSocketPayload,
  CatchupPayload,
  PostRoomPayload,
  ActivityRoomPayload,
  CommunityRoomPayload,
  JoinRoomsPayload,
  INVALID_PAYLOAD,
} from './socket-payloads';

/**
 * The client address behind a socket.
 *
 * engine.io does not run through Express, so `req.ip` and its trust-proxy
 * resolution are unavailable here. The handshake does carry the forwarded
 * chain, and the RIGHT-hand entries are the ones our own infrastructure
 * appended — the leftmost is caller-supplied, which is the value the HTTP
 * guards were rewritten to stop trusting. Read from the right by the same hop
 * count the HTTP side uses.
 */
function socketIp(client: AppSocket): string {
  const forwarded = client?.handshake?.headers?.['x-forwarded-for'];
  const hops = config.rateLimit.trustProxyHops;

  if (typeof forwarded === 'string' && hops > 0) {
    const chain = forwarded
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const picked = chain[chain.length - hops];
    if (picked) return normalizeIp(picked);
  }

  return normalizeIp(client?.handshake?.address || client?.conn?.remoteAddress);
}

/**
 * A domain event as the gateway routes it. Events arrive from Redis as parsed
 * JSON, so nothing about their shape is guaranteed: the original object is
 * kept for forwarding, and every field used for ROUTING is read through
 * `top`/`inData`, which answer only with a non-empty string.
 */
interface RoutableDomainEvent {
  payload: Record<string, unknown>;
  type: string;
  data: Record<string, unknown>;
  top: (key: string) => string | undefined;
  inData: (key: string) => string | undefined;
}

function readDomainEvent(raw: unknown): RoutableDomainEvent | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  const data = isRecord(raw.data) ? raw.data : {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    payload: raw,
    type: raw.type,
    data,
    top: (key) => str(raw[key]),
    inData: (key) => str(data[key]),
  };
}

/** Ack text per policy, so a socket rejection reads like the REST one. */
const RATE_LIMIT_MESSAGES: Record<string, string> = Object.fromEntries(
  Object.entries(RATE_LIMIT_POLICIES).map(([name, spec]) => [
    name,
    spec.message,
  ]),
);

@WebSocketGateway({
  cors: {
    // Reuses the HTTP allow-list rather than reflecting whatever Origin the
    // caller sends. `origin: true` echoed any origin back, so the socket
    // endpoint was reachable cross-origin from any site while the HTTP API
    // beside it was carefully restricted.
    origin: socketCorsOrigin,
    credentials: true,
  },
})
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger('SOCKET');
  private readonly chatLogger = new Logger('CHAT');

  // Assigned by Nest when the gateway is bound, before any handler runs.
  @WebSocketServer()
  server!: AppServer;

  /**
   * Which conversation a user may address by a given id or publicId, cached
   * briefly because typing and receipts are high-frequency. A hit is trusted
   * for 30 s, so a participant who leaves can still send typing or receipts
   * for up to that long; a miss is kept for 5 s only, so someone just added
   * to a group is not left waiting.
   */
  private readonly participantConvCache = new Map<
    string,
    { conv: { id: string; publicId: string | null } | null; expiresAt: number }
  >();
  private static readonly PARTICIPANT_HIT_TTL_MS = 30_000;
  private static readonly PARTICIPANT_MISS_TTL_MS = 5_000;
  private static readonly PARTICIPANT_CACHE_MAX = 10_000;

  // Sweep interval for proactive in-memory cache eviction
  private sessionSweepTimer?: NodeJS.Timeout;
  private cacheEvictionTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly messagesService: MessagesService,
    private readonly presenceService: PresenceService,
    private readonly instantMatchService: InstantMatchService,
    private readonly instantMatchLimiter: InstantMatchRateLimiter,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly activityPolicy: ActivityAuthorizationService,
    private readonly communitiesService: CommunitiesService,
    // Presence fan-out runs through this gateway, so it needs the block list to
    // avoid pushing a status change across a block.
    private readonly blocksService: BlocksService,
    // The same policy the HTTP guard and the messaging services use, so a
    // socket cannot become the one path with a looser rule.
    private readonly verificationAccess: VerificationAccessService,
    // First-year isolation: only to resolve the viewer's batch onto the
    // activity auth context below. The decision belongs to the two policies.
    private readonly studentYearPolicy: StudentYearPolicyService,
    // Redis-backed limits for the durable socket actions. The in-process
    // InstantMatchRateLimiter it replaces counted per PROCESS, so the real
    // ceiling was silently multiplied by the replica count and reset on every
    // deploy; it is kept below purely for the ephemeral events, where
    // per-process accuracy is the point.
    private readonly rateLimit: RateLimitService,
    // The same mandatory-acknowledgement gate JwtGuard applies to every REST
    // route, so a socket cannot become the one path that skips it.
    private readonly legalConsent: LegalConsentService,
    @Optional() private readonly jwtGuard?: JwtGuard,
  ) {}

  /**
   * Enforces policies for a socket event.
   *
   * Returns an error ack to hand straight back to the client, or null when the
   * action is allowed. Socket events cannot carry HTTP headers, so the ack
   * carries the same stable code and retry hint the REST 429 does.
   */
  private async limitEvent(
    userId: string,
    policies: Array<{ policy: RateLimitPolicyName; identifier: string }>,
  ): Promise<{
    status: 'error';
    error: string;
    code: number;
    retryAfterSeconds: number;
  } | null> {
    const decision = await this.rateLimit.consumeAll(policies);
    if (decision.allowed) return null;

    const spec = RATE_LIMIT_MESSAGES[decision.policy];
    return {
      status: 'error',
      error: spec ?? 'Too many requests. Please slow down.',
      code: 429,
      retryAfterSeconds: decision.resetSeconds,
    };
  }

  /**
   * Throttle for high-frequency ephemeral events (typing, heartbeat, ping).
   *
   * Deliberately in-process and deliberately SILENT: these fire many times a
   * minute per socket, so a Redis round-trip each would cost more than the
   * events themselves, and the thing being protected is this process's event
   * loop. A dropped typing indicator is invisible; a typing indicator that
   * raises an error toast is a bug.
   */
  private allowEphemeral(
    key: string,
    points: number,
    windowMs: number,
  ): boolean {
    return this.instantMatchLimiter.consume(key, points, windowMs);
  }

  afterInit() {
    // Register this gateway as the emit target for InstantMatchService
    setRealtimeGatewayRef(this);

    this.presenceService.registerSocketValidator((socketId: string) => {
      const s = this.server?.sockets?.sockets?.get(socketId);
      return Boolean(s && s.connected);
    });

    this.presenceService.onStatusChange((userId, status, lastSeen) =>
      detach('presence status broadcast', async () => {
        await this.broadcastPresenceUpdate(userId, status, lastSeen);
        void this.broadcastCommunityPresence(userId);
      }),
    );

    this.setupDomainEventSubscriber();

    /**
     * Disconnect sockets whose session has since been revoked.
     *
     * The connect-time check above stops a revoked session opening a NEW
     * connection; this is what ends one that is already open. Without it,
     * signing out a device left its existing socket in place, still receiving
     * messages, until the user happened to close the tab.
     *
     * A sweep rather than a push: revocation happens in the HTTP process, which
     * on more than one replica is not the process holding the socket, so a
     * direct call would only ever reach a fraction of them. Sixty seconds
     * bounds how long a revoked device keeps listening; making it immediate
     * everywhere needs the revocation broadcast over Redis, which is the right
     * next step if that minute matters.
     */
    this.sessionSweepTimer = setInterval(() => {
      void this.disconnectRevokedSessions();
    }, 60_000);
    this.sessionSweepTimer.unref?.();

    // Proactively evict stale entries from in-memory caches every 10 minutes.
    // Without this, entries only age out on access; long-lived servers with many
    // conversations accumulate unbounded Map entries over time.
    this.cacheEvictionTimer = setInterval(
      () => {
        const now = Date.now();
        for (const [key, val] of this.participantConvCache.entries()) {
          if (val.expiresAt <= now) this.participantConvCache.delete(key);
        }
      },
      10 * 60 * 1000,
    );
  }

  /**
   * Refreshes the "active now" figure for every community this user belongs
   * to, whenever they come online or go offline.
   *
   * `onStatusChange` fires only on an actual transition — not on every 25s
   * heartbeat — so this costs one membership lookup per genuine connect or
   * disconnect, not per tick. The count itself is deliberately recomputed
   * server-side rather than incremented on the client: a client that
   * incremented locally would drift out of step after any missed event, a
   * reconnect, or a second tab.
   *
   * Emitted to `community_<id>`, so only people actually looking at that
   * community pay for the update.
   */
  private async broadcastCommunityPresence(userId: string) {
    try {
      const communityIds =
        await this.communitiesService.getCommunityIdsForUser(userId);
      if (communityIds.length === 0) return;

      for (const communityId of communityIds) {
        const room = `community_${communityId}`;
        // Nobody is watching this community — recomputing would be wasted work.
        if (!this.server?.sockets.adapter.rooms.get(room)) continue;
        const online =
          await this.communitiesService.countOnlineMembers(communityId);
        this.server
          .to(room)
          .emit('community:presence', { communityId, online });
      }
    } catch {
      this.logger.warn(`Failed to broadcast community presence for ${userId}`);
    }
  }

  private async broadcastPresenceUpdate(
    userId: string,
    status: string,
    lastSeen: string,
  ) {
    const presencePayload = { userId, status, lastActive: lastSeen };

    try {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          settings: {
            select: { showOnlineStatus: true, whoCanSeeOnline: true },
          },
        },
      });
      const rule = targetUser?.settings?.whoCanSeeOnline || 'everyone';
      const isEnabled = targetUser?.settings?.showOnlineStatus !== false;

      // Always broadcast to the user's personal room (for multi-device sync)
      this.server.to(userId).emit('presence:update', presencePayload);

      if (!isEnabled || rule === 'nobody') {
        return; // Already emitted to self
      }

      // For EVERY rule (including 'everyone') we must respect reciprocity: a
      // viewer who has hidden their own online status must not receive anyone
      // else's presence. Room-based fan-out (`conv_<id>`) cannot filter
      // per-viewer, so we always resolve the concrete allowed-viewer set via
      // checkPresenceVisibilityBatch and emit to those personal user rooms.
      // (checkPresenceVisibilityBatch already handles 'everyone' by returning
      // all non-hidden viewers.)
      const sharedConvs = await this.prisma.conversationParticipant.findMany({
        where: {
          conversation: {
            participants: {
              some: { userId: userId, deletedAt: null, leftAt: null },
            },
          },
          deletedAt: null,
          leftAt: null,
        },
        select: { userId: true },
      });
      const uniqueViewerIds = [
        ...new Set(
          sharedConvs.map((p) => p.userId).filter((id) => id !== userId),
        ),
      ];

      if (uniqueViewerIds.length > 0) {
        const allowedViewerIds = await checkPresenceVisibilityBatch(
          userId,
          uniqueViewerIds,
          rule,
          isEnabled,
          this.prisma,
          this.blocksService,
        );
        if (allowedViewerIds.length > 0) {
          this.server
            .to(allowedViewerIds)
            .emit('presence:update', presencePayload);
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to broadcast presence update for user=${userId}`,
        err,
      );
    }
  }

  private setupDomainEventSubscriber() {
    const subClient = this.redisService.getSubClient();
    if (subClient) {
      void subClient.subscribe('meetifyy:domain_events', (err) => {
        if (err) this.logger.error('Failed to subscribe to domain events', err);
      });
      subClient.on('message', (channel, message) => {
        if (channel === 'meetifyy:domain_events') {
          try {
            const payload: unknown = JSON.parse(message);
            this.handleDomainEvent(payload);
          } catch (e) {
            this.logger.error('Failed to parse domain event payload', e);
          }
        }
      });
    }
  }

  @OnEvent('**')
  handleLocalDomainEvent(payload: unknown) {
    if (isRecord(payload) && payload.type) {
      // Fallback for single instance or local dev without Redis Pub/Sub
      if (!this.redisService.getSubClient()) {
        this.handleDomainEvent(payload);
      }
    }
  }

  private handleDomainEvent(event: unknown) {
    const parsed = readDomainEvent(event);
    if (!parsed) return;
    // `payload` is forwarded to clients exactly as published; routing reads
    // only go through `top`/`inData`, which yield non-empty strings or nothing.
    const { payload, type, data, top, inData } = parsed;

    // Cross-instance cache invalidation. VerificationAccessService caches
    // status in process, and this handler runs on EVERY instance (the event
    // arrives over Redis pub/sub), so an approval or revocation on one node
    // evicts the stale entry on all of them. Without this the cache's TTL
    // would be the real security window instead of a backstop.
    if (type === 'user:verification_changed') {
      const changedUserId = inData('userId') || top('targetUserId');
      if (changedUserId) this.verificationAccess.invalidate(changedUserId);
    }

    if (type === 'user.settings_updated') {
      const uId = top('targetUserId') || inData('userId');
      if (uId) {
        // Always force broadcast offline to all group rooms so clients immediately hide the status
        const offlinePayload = {
          userId: uId,
          status: 'offline',
          lastActive: new Date().toISOString(),
        };
        this.prisma.conversationParticipant
          .findMany({
            where: { userId: uId, deletedAt: null, leftAt: null },
            select: { conversationId: true },
          })
          .then((userConvs) => {
            userConvs.forEach((c) => {
              if (c.conversationId)
                this.server
                  .to(`conv_${c.conversationId}`)
                  .emit('presence:update', offlinePayload);
            });
          })
          .catch(() => {});

        // Re-evaluate and broadcast true status based on new rules
        this.presenceService
          .getPresence(uId)
          .then((presence) => {
            const status = presence?.status || 'offline';
            const lastSeen = presence?.lastSeen || new Date().toISOString();
            void this.broadcastPresenceUpdate(uId, status, lastSeen);
          })
          .catch(() => {});
      }
    }

    if (type === 'group:member_added') {
      const convId = inData('conversationId') || top('conversationId');
      const targetUser = inData('userId') || top('userId');
      if (convId && targetUser) {
        const userSockets = this.server.sockets.adapter.rooms.get(targetUser);
        if (userSockets) {
          userSockets.forEach((socketId) => {
            const socket = this.server.sockets.sockets.get(socketId);
            if (socket) void socket.join(`conv_${convId}`);
          });
        }
      }
    }

    if (type === 'group:member_removed') {
      const convId = inData('conversationId') || top('conversationId');
      const targetUser =
        inData('targetUserId') || top('targetUserId') || inData('userId');
      if (convId && targetUser) {
        const userSockets = this.server.sockets.adapter.rooms.get(targetUser);
        if (userSockets) {
          userSockets.forEach((socketId) => {
            const socket = this.server.sockets.sockets.get(socketId);
            if (socket) void socket.leave(`conv_${convId}`);
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
    const postScopeId = inData('postId') || top('postId');
    if (postScopeId && RealtimeGateway.POST_ROOM_EVENTS.has(type)) {
      this.server.to(`post_${postScopeId}`).emit('domainEvent', payload);
    }

    // Activity discussion: fan out to everyone currently viewing the activity
    // (they joined `activity_<id>` via 'activity:join'). Purely room-scoped —
    // there is no participant set, so return once broadcast.
    // A visibility change is authorization-relevant: re-run the policy for every
    // socket in the room and evict the ones that just lost access. The event
    // itself carries no activity details.
    if (type === 'activity.visibilityChanged') {
      const changedId = inData('activityId') || inData('id');
      if (changedId) {
        // Evict first, notify second — the surviving subscribers are exactly the
        // ones still authorized when the event lands.
        this.revalidateActivityRoom(changedId)
          .then(() => {
            this.server
              .to(`activity_${changedId}`)
              .emit('domainEvent', payload);
          })
          .catch(() => {});
      }
      return;
    }

    if (type === 'activity_discussion.created') {
      const activityScopeId = inData('activityId');
      if (activityScopeId) {
        this.server
          .to(`activity_${activityScopeId}`)
          .emit('activity_discussion:new', data.message);
      }
      return;
    }

    // Membership changes fan out to everyone currently viewing the activity
    // (joined `activity_<id>` via 'activity:join'), so attendee counts and
    // avatars update live instead of waiting for a refetch. Previously these
    // carried no targetUserIds and were dropped with a warning.
    // Lifecycle changes for an activity reach everyone currently LOOKING at it.
    // `activity_<id>` is an authorization-checked room (see
    // checkActivityRoomAccess), so this is a safe fan-out, and it is what makes
    // a detail page that is already open react to the activity starting,
    // ending or being cancelled without the viewer refreshing.
    if (type === 'activity.updated' || type === 'activity.started') {
      const activityScopeId = inData('activityId') || inData('id');
      if (activityScopeId) {
        this.server
          .to(`activity_${activityScopeId}`)
          .emit('domainEvent', payload);
        return;
      }
    }

    if (type === 'activity.memberJoined' || type === 'activity.memberLeft') {
      const activityScopeId = inData('activityId') || top('activityId');
      if (activityScopeId) {
        this.server
          .to(`activity_${activityScopeId}`)
          .emit('domainEvent', payload);
      }
      return;
    }

    // A user's avatar is denormalised into almost every payload the app
    // renders — post authors, comment authors, chat participants, member lists,
    // invite and share pickers. There is no room that corresponds to "everyone
    // who can currently see this person", and a targeted emit would leave the
    // old image on every other client until each of their queries happened to
    // refetch. It is a tiny, infrequent payload, so it goes to everyone.
    if (type === 'user.updated') {
      this.server.emit('domainEvent', payload);
      return;
    }

    const isLegacyEvent = type.includes(':');
    let targets: string[] = [];

    const commId = top('communityId') || inData('communityId');
    if (commId) {
      // ONE event, to the room, on the generic bus.
      //
      // This used to fan a single membership change out four ways: two
      // bespoke events plus `domainEvent` to the room, and then
      // `server.emit` — a broadcast to every connected socket in the
      // application. So one person joining any community woke every client
      // everywhere, and clients inside the room ran three separate handlers
      // for the same change. That fan-out is why a join made everyone's
      // screen flicker rather than only the members who were looking at it.
      //
      // Room-scoped is the correct blast radius: a membership change is only
      // visible on that community's surfaces. Anyone not in the room finds
      // out the next time they open it.
      this.server.to(`community_${commId}`).emit('domainEvent', payload);
    }

    const listedTargets = Array.isArray(payload.targetUserIds)
      ? payload.targetUserIds.filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        )
      : [];
    const convId = top('conversationId') || inData('conversationId');
    if (listedTargets.length > 0) {
      targets = listedTargets;
    } else if (top('targetUserId')) {
      targets = [top('targetUserId') as string];
    } else if (inData('targetUserId')) {
      targets = [inData('targetUserId') as string];
    } else if (convId) {
      this.server
        .to(`conv_${convId}`)
        .emit(isLegacyEvent ? type : 'domainEvent', payload.data || payload);
      return;
    }

    if (targets.length > 0) {
      for (const targetId of targets) {
        if (isLegacyEvent) {
          this.server.to(targetId).emit(type, payload.data);
        } else {
          this.server.to(targetId).emit('domainEvent', payload);
        }
      }
    } else if (!commId) {
      this.logger.warn(
        `Domain event '${type}' has no valid targetUserIds/room — dropped safely`,
      );
    }
  }

  /**
   * Ends the connections of sessions that are no longer valid.
   *
   * Reads the ids off the live sockets and asks in one query which of them are
   * dead, rather than one query per socket — a busy instance holds thousands.
   */
  private async disconnectRevokedSessions(): Promise<void> {
    try {
      const sockets = this.server?.sockets?.sockets;
      if (!sockets || sockets.size === 0) return;

      const bySession = new Map<string, AppSocket[]>();
      for (const socket of sockets.values()) {
        const id = socket.data.sessionId;
        if (typeof id !== 'string' || !id) continue;
        const list = bySession.get(id) || [];
        list.push(socket);
        bySession.set(id, list);
      }
      if (bySession.size === 0) return;

      const ids = Array.from(bySession.keys());
      const alive = await this.prisma.userSession.findMany({
        where: {
          id: { in: ids },
          revoked: false,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      const aliveIds = new Set(alive.map((s) => s.id));

      for (const [sessionId, list] of bySession) {
        if (aliveIds.has(sessionId)) continue;
        for (const socket of list) {
          socket.emit('session:revoked', { reason: 'signed_out' });
          socket.disconnect(true);
        }
      }
    } catch (err) {
      // A sweep that fails must not take the gateway with it; the next one runs
      // in a minute, and the connect-time check still holds the line.
      this.logger.warn(`session sweep failed: ${(err as Error).message}`);
    }
  }

  /**
   * Stop the timers.
   *
   * Neither was cleared before: the cache eviction interval outlived the
   * gateway, which in tests means an open handle keeping the process alive and
   * in production means a stale instance still doing work after shutdown
   * begins. The sweep is unref'd so it cannot hold the process open on its own,
   * but both should stop when the module does.
   */
  onModuleDestroy(): void {
    if (this.sessionSweepTimer) clearInterval(this.sessionSweepTimer);
    if (this.cacheEvictionTimer) clearInterval(this.cacheEvictionTimer);
  }

  async handleConnection(client: AppSocket) {
    // Connection limiting comes in two tiers, and the ORDER is load-bearing.
    //
    // This one is per-address and runs BEFORE the token is verified, because
    // verification is not free: `validateToken` falls back to a remote Supabase
    // call when local verification fails, so a flood of garbage tokens from one
    // host would otherwise become one outbound Supabase request per attempt —
    // turning our own handshake into an amplifier against our auth provider.
    // Bounding it here caps that exposure.
    //
    // It has to stay coarse, though: a campus NAT gateway or carrier CGNAT
    // presents thousands of students as ONE address, so this budget is shared
    // by all of them and a tight value would lock out a whole campus after a
    // deploy. The precise work is done by `socket.connect.user` further down,
    // which is keyed on the verified account and has no such problem.
    //
    // Failing open here is deliberate — a limiter problem must not stop people
    // reconnecting to chat.
    try {
      const connectDecision = await this.rateLimit.consume(
        'socket.connect.ip',
        socketIp(client),
      );
      if (!connectDecision.allowed) {
        this.logger.warn('Connection refused: reconnecting too frequently');
        client.emit('connect:rate_limited', {
          code: 'rate_limited',
          retryAfterSeconds: connectDecision.resetSeconds,
        });
        client.disconnect();
        return;
      }
    } catch {
      // Never block a reconnect because the limiter itself failed.
    }

    /**
     * Handshake token, or the session cookie.
     *
     * Sockets used to take the access token from `handshake.auth`, which meant
     * the page had to be holding one in JavaScript to connect at all. Now that
     * the durable session is an HttpOnly cookie the page cannot read, the
     * cookie the browser attaches to the handshake is the credential — and it
     * is the better one, because a script on the origin cannot lift it.
     *
     * Both paths land on the same `validateToken` below, and — unlike before —
     * both then have to name a live session. See the revocation check further
     * down for why that exemption could not stay.
     */
    // `handshake.auth` is whatever the client sent; only a string is a token.
    const authToken: unknown = client.handshake.auth?.token;
    const token =
      (typeof authToken === 'string' && authToken) ||
      cookieToken(client.handshake.headers);

    if (!token) {
      this.logger.warn(`Client connection rejected: missing token`);
      client.disconnect();
      return;
    }

    let userId: string = '';
    let userName: string = 'Unknown';

    if (!this.supabaseService.isConfigured) {
      this.logger.warn(
        `Client connection rejected: Supabase Auth not configured`,
      );
      client.disconnect();
      return;
    }
    // From JwtGuard (an AuthenticatedUser) or, without it, from Supabase.
    let user: {
      id: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
    } | null = null;
    try {
      if (this.jwtGuard) {
        user = await this.jwtGuard.validateToken(token);
      } else {
        const {
          data: { user: remoteUser },
          error,
        } = await this.supabaseService.client.auth.getUser(token);
        if (!error && remoteUser) {
          user = {
            id: remoteUser.id,
            email: remoteUser.email,
            user_metadata: remoteUser.user_metadata,
          };
        }
      }
    } catch (err) {
      this.logger.error(
        'WebSocket connection authentication check failed',
        err,
      );
      client.disconnect();
      return;
    }

    if (!user || !user.id) {
      this.logger.warn(`Client connection rejected: invalid token`);
      client.disconnect();
      return;
    }

    // A valid token is not enough. An account inside its deletion window keeps
    // a working token on purpose (it needs one to recover), and the REST gate
    // that refuses it lives in JwtGuard — which sockets never pass through. So
    // without this check a deleting user could keep a live socket: appear
    // online, receive presence and typing events, and read new messages, while
    // every HTTP route told them the account was gone. The status is read from
    // the database rather than the token because the token predates the state
    // change and will keep asserting an active account until it expires.
    /**
     * A revoked session must not hold a socket either.
     *
     * The REST guard refuses a revoked session on the next request, but the
     * socket was authenticated once at connect and never re-checked — so a
     * device that had been signed out kept its connection and went on receiving
     * new messages, typing and presence in real time. Signing a device out has
     * to mean it stops seeing things, not just that it stops being able to ask.
     *
     * Enforced for EVERY handshake, including one that supplied its own token.
     *
     * It used to be skipped whenever `handshake.auth.token` was set, on the
     * reasoning that such a connection has no session behind it. That is true,
     * and it is the problem rather than the justification: supplying a token in
     * the handshake was all it took to opt out of revocation, so a signed-out
     * or revoked device could keep a live socket — receiving messages, typing
     * and presence in real time — for as long as its access token remained
     * cryptographically valid. Signing a device out has to mean it stops seeing
     * things.
     *
     * The app has not sent a handshake token since the session became a cookie;
     * the gateway simply went on honouring one.
     */
    const handshakeSessionId = cookieValue(
      client.handshake.headers,
      USER_SESSION_ID_COOKIE,
    );
    if (!handshakeSessionId) {
      this.logger.warn('Client connection rejected: no session id');
      client.disconnect();
      return;
    }
    {
      const session = await this.prisma.userSession
        .findUnique({
          where: { id: handshakeSessionId },
          select: { revoked: true, expiresAt: true, userId: true },
        })
        .catch(() => null);

      // Fails closed, like the REST path: a lookup that did not answer must not
      // grant the connection.
      if (
        !session ||
        session.revoked ||
        session.expiresAt <= new Date() ||
        session.userId !== user.id
      ) {
        this.logger.warn(
          "Client connection rejected: session revoked or not the caller's",
        );
        client.disconnect();
        return;
      }
      client.data.sessionId = handshakeSessionId;
    }

    const lifecycle = await this.prisma.user
      .findUnique({
        where: { id: user.id },
        select: { accountStatus: true },
      })
      .catch(() => null);

    if (
      lifecycle?.accountStatus === 'PENDING_DELETION' ||
      lifecycle?.accountStatus === 'DELETED'
    ) {
      this.logger.warn(
        `Client connection rejected: account ${user.id} is ${lifecycle.accountStatus}`,
      );
      // Told apart from an auth failure so the client shows the recovery gate
      // rather than bouncing the user to the sign-in screen.
      client.emit('account:unavailable', {
        code: 'ACCOUNT_PENDING_DELETION',
      });
      client.disconnect();
      return;
    }

    // The same gate JwtGuard applies to every REST route. A socket is not a
    // read-only side channel — it delivers messages, presence and typing — so
    // an account that has not accepted a mandatory policy update must not hold
    // one. Without this, refusing every HTTP route while leaving the socket
    // connected would let someone keep using the parts of Meetifyy that matter
    // most while the modal sat on screen.
    try {
      const consentSatisfied = await this.legalConsent.isSatisfied(user.id);
      if (!consentSatisfied) {
        this.logger.warn(
          `Client connection rejected: account ${user.id} has not accepted a required legal update`,
        );
        // Told apart from an auth failure so the client shows the consent flow
        // rather than bouncing the user to the sign-in screen.
        client.emit('account:unavailable', {
          code: LEGAL_ACKNOWLEDGEMENT_REQUIRED_CODE,
        });
        client.disconnect();
        return;
      }
    } catch (err) {
      // Fails open, exactly as the service itself does: a broken consent
      // lookup must not take chat down for everyone.
      this.logger.warn(
        `Legal consent check failed for ${user.id}: ${(err as Error).message}`,
      );
    }

    userId = user.id;

    // The per-USER connect tier. Deliberately applied here rather than beside
    // the per-IP check above: only now is the account known, and being keyed on
    // a verified identity means it can be tight without a shared campus address
    // ever collapsing many students into one budget.
    //
    // Fails open on a limiter error for the same reason the IP tier does —
    // nobody should be locked out of chat because a counter broke.
    try {
      const perUser = await this.rateLimit.consume(
        'socket.connect.user',
        userId,
      );
      if (!perUser.allowed) {
        this.logger.warn(
          `Connection refused: user=${userId} reconnecting too frequently`,
        );
        client.emit('connect:rate_limited', {
          code: 'rate_limited',
          retryAfterSeconds: perUser.resetSeconds,
        });
        client.disconnect();
        return;
      }
    } catch {
      // Never block a reconnect because the limiter itself failed.
    }

    // Provider metadata is arbitrary JSON; only a string is a name.
    const metaName = (key: string): string | undefined => {
      const value = user.user_metadata?.[key];
      return typeof value === 'string' && value ? value : undefined;
    };
    userName =
      metaName('username') ||
      metaName('displayName') ||
      user.email ||
      'Unknown';

    client.data.userId = userId;
    client.data.userName = userName;
    void client.join(userId); // Join user's personal room for multiplexed broadcasting

    // Automatically join all active conversation rooms for O(1) broadcasting.
    // Cache the internal conv IDs on the socket so handleDisconnect can read them
    // without a second DB round-trip on every tab close / network drop.
    try {
      const activeConvs = await this.prisma.conversationParticipant.findMany({
        where: { userId, deletedAt: null, leftAt: null },
        select: {
          conversationId: true,
          conversation: { select: { publicId: true } },
        },
      });
      const cachedConvIds: string[] = [];
      activeConvs.forEach((p) => {
        if (p.conversationId) {
          void client.join(`conv_${p.conversationId}`);
          cachedConvIds.push(p.conversationId);
        }
        if (p.conversation?.publicId)
          void client.join(`conv_${p.conversation.publicId}`);
      });
      client.data.userConvIds = cachedConvIds;
    } catch (err) {
      this.logger.error('Failed to pre-join conversation rooms', err);
      client.data.userConvIds = [];
    }

    await this.presenceService.setOnline(userId, client.id);

    this.logger.log(`Connected user=${userId} socket=${client.id}`);
  }

  async handleDisconnect(client: AppSocket) {
    const userId = client.data.userId;

    if (userId) {
      // Use the conv IDs cached at connection time — avoids a DB query on every
      // disconnect (tab close, network drop, mobile background, etc.).
      const userConvIds: string[] = client.data.userConvIds || [];

      userConvIds.forEach((cId) => {
        this.server
          .to(`conv_${cId}`)
          .emit('typing:stop', { conversationId: cId, userId });
      });

      await this.presenceService.setOffline(userId, client.id);
    }
    this.logger.log(
      `Disconnected user=${userId || 'unknown'} socket=${client.id}`,
    );
  }

  @SubscribeMessage('presence:heartbeat')
  async handlePresenceHeartbeat(@ConnectedSocket() client: AppSocket) {
    const userId = client.data.userId;
    if (!userId) return { status: 'error', error: 'Unauthenticated' };
    // The client sends one every 25s; 6/min absorbs a reconnect without
    // letting a stuck client spin. Silent — a dropped heartbeat is harmless.
    if (!this.allowEphemeral(`hb:${client.id}`, 6, 60_000)) return;
    await this.presenceService.setOnline(userId, client.id);
    return { status: 'ok', timestamp: Date.now() };
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const senderId = client.data.userId;
    if (!senderId) return { status: 'error', error: 'Unauthenticated' };
    const clientKey = correlationIdOf(data);
    // The same DTO the HTTP route validates with, so the socket is not the one
    // path that accepts a malformed message.
    const parsed = parseSocketPayload(SocketSendMessagePayload, data);
    const conversationId = parsed.ok ? parsed.value.conversationId : undefined;
    if (!parsed.ok || !conversationId) {
      return {
        status: 'error',
        tempId: clientKey,
        clientId: clientKey,
        error: 'Invalid message',
      };
    }
    try {
      const message = await this.messagesService.sendMessage(
        senderId,
        conversationId,
        parsed.value,
      );
      const payload = {
        ...message,
        tempId: clientKey,
        clientId: clientKey,
        status: 'sent',
      };

      // Block enforcement: sendMessage already computed recipientIds, which
      // EXCLUDES any participant who has blocked the sender (or whom the sender
      // blocked). We must deliver to those recipients' personal rooms rather
      // than fan out to `conv_<id>`, because a room broadcast would leak the
      // message to a user who blocked the sender. This mirrors the HTTP
      // controller path (MessagesController.sendMessage) exactly so realtime
      // and REST enforce blocks identically.
      const recipientIds: string[] = message.recipientIds || [];
      // Mute is enforced here, not left to the client. `sendMessage` already
      // resolved every recipient's mute state in the same batched query it
      // used for blocks, so stamping each copy with whether it may raise an
      // alert costs nothing — and means a device with a cold or stale
      // conversation cache still honours the mute. The message itself is
      // delivered either way: mute silences the alert, not the sync.
      const unmuted = new Set<string>(message.unmutedRecipientIds || []);
      for (const rId of recipientIds) {
        if (rId === senderId) continue;
        this.server
          .to(rId)
          .emit('message:new', { ...payload, alert: unmuted.has(rId) });
      }
      // Multi-device sync: emit to sender's OTHER connected sockets/tabs.
      // Never alerted — the sender already knows.
      client.to(senderId).emit('message:new', { ...payload, alert: false });

      // Return server ACK directly to sending client callback
      return {
        status: 'ok',
        tempId: clientKey,
        clientId: clientKey,
        message: payload,
      };
    } catch (err) {
      return {
        status: 'error',
        tempId: clientKey,
        clientId: clientKey,
        error: errorMessage(err) || 'Failed to send message',
      };
    }
  }

  @SubscribeMessage('message:catchup')
  async handleMessageCatchup(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const userId = client.data.userId;
    const parsed = parseSocketPayload(CatchupPayload, data);
    if (!userId || !parsed.ok)
      return { status: 'error', error: 'Invalid parameters' };
    const { since } = parsed.value;

    // The other reconnect-time query. Capped so a mass disconnect cannot turn
    // into a thundering herd against Postgres.
    const limited = await this.limitEvent(userId, [
      { policy: 'socket.catchup.user', identifier: userId },
    ]);
    if (limited) return limited;

    try {
      const messages = await this.messagesService.getCatchupMessages(
        userId,
        since,
      );
      return { status: 'ok', messages };
    } catch (err) {
      return {
        status: 'error',
        error: errorMessage(err) || 'Failed to fetch catchup messages',
      };
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
  // Each room join carries an authorization check, so a client cycling rooms
  // is a cheap way to make the server do work.
  @SubscribeMessage('post:join')
  async handlePostJoin(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const parsed = parseSocketPayload(PostRoomPayload, data);
    if (!parsed.ok) return INVALID_PAYLOAD;
    const { postId } = parsed.value;
    const userId = client.data.userId;
    if (!userId) return;
    const limited = await this.limitEvent(userId, [
      { policy: 'socket.roomjoin.user', identifier: userId },
    ]);
    if (limited) return limited;

    // Same reasoning as `activity:join` below: room membership is an
    // authorization decision, not a client preference.
    //
    // This room carries `comment.created` — which includes the comment body and
    // its author — plus like and poll activity. Joining it took the post id on
    // the client's word, so any authenticated socket could name any post id and
    // receive its comments live, including posts the REST route answers with a
    // 404: a blocked author's, or one hidden by first-year isolation. The
    // policy below is the one `getPostById` applies, so the two paths agree.
    const allowed = await this.checkPostRoomAccess(userId, postId);
    if (!allowed) {
      void client.leave(`post_${postId}`);
      return;
    }

    void client.join(`post_${postId}`);
  }

  /**
   * Server-side authorization for the `post_<id>` realtime room.
   *
   * Deliberately mirrors `PostsService.getPostById`'s denial set — deleted post,
   * deleted community, unavailable author, a block in either direction, and
   * first-year isolation judged on the author — because a viewer who cannot
   * open the post must not be able to subscribe to it either. It answers a bare
   * boolean for the same reason that route answers a neutral 404: the caller
   * must not be able to tell "no such post" from "not for you".
   */
  private async checkPostRoomAccess(
    userId: string,
    postId: string,
  ): Promise<boolean> {
    try {
      const post = await this.prisma.post.findFirst({
        where: { id: postId, deletedAt: null, author: { deletedAt: null } },
        select: {
          authorId: true,
          community: { select: { deletedAt: true } },
        },
      });
      if (!post || post.community?.deletedAt) return false;

      // A user is always allowed into the room for their own post, and the
      // policy calls below would say the same — this just skips them.
      if (post.authorId === userId) return true;

      const excluded = await this.blocksService.getExcludedUserIds(userId);
      if (excluded.includes(post.authorId)) return false;

      return await this.studentYearPolicy.canIdsInteract(
        userId,
        post.authorId,
        'activity_visibility',
      );
    } catch (err) {
      // Fail closed: an error resolving the policy must not grant the room.
      this.logger.error('Failed to authorize post room join', err);
      return false;
    }
  }

  @SubscribeMessage('post:leave')
  handlePostLeave(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const parsed = parseSocketPayload(PostRoomPayload, data);
    if (!parsed.ok) return INVALID_PAYLOAD;
    void client.leave(`post_${parsed.value.postId}`);
  }

  // A client viewing an activity joins its discussion room so it receives live
  // discussion messages; it leaves on unmount. Rooms are per-socket and
  // auto-cleaned on disconnect, so a missed 'activity:leave' can't leak.
  @SubscribeMessage('activity:join')
  async handleActivityJoin(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const parsed = parseSocketPayload(ActivityRoomPayload, data);
    if (!parsed.ok) return INVALID_PAYLOAD;
    const { activityId } = parsed.value;
    const userId = client.data.userId;
    if (!userId) return;

    const limited = await this.limitEvent(userId, [
      { policy: 'socket.roomjoin.user', identifier: userId },
    ]);
    if (limited) return limited;

    // Room membership is an authorization decision, not a client preference:
    // the room carries discussion messages, attendee changes and activity
    // metadata, so a viewer who may not open the activity may not subscribe.
    const decision = await this.checkActivityRoomAccess(userId, activityId);
    if (!decision.allowed) {
      client.emit('activity:access_denied', {
        activityId: activityId,
        code: decision.code,
        message: decision.reason,
      });
      void client.leave(`activity_${activityId}`);
      return;
    }
    void client.join(`activity_${activityId}`);
  }

  /**
   * Server-side authorization for the `activity_<id>` realtime room, resolved
   * from the DB through the shared activity access policy.
   */
  private async checkActivityRoomAccess(userId: string, activityId: string) {
    try {
      const [activity, user] = await Promise.all([
        this.prisma.crewActivity.findUnique({
          where: { id: activityId },
          select: {
            id: true,
            creatorId: true,
            collegeId: true,
            visibility: true,
            status: true,
            deletedAt: true,
            members: {
              where: { userId },
              select: { userId: true, status: true },
            },
            invitations: {
              where: { inviteeId: userId },
              select: {
                inviteeId: true,
                status: true,
                revokedAt: true,
                expiresAt: true,
              },
            },
            // The host's batch, for first-year isolation. The realtime room is
            // the activity's live surface; the socket must apply the same rule
            // the REST detail endpoint does, or a restricted viewer could
            // subscribe to updates for an activity they cannot open.
            creator: { select: { batchYear: true } },
          },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            collegeId: true,
            // First-year isolation: the viewer's batch, resolved on the
            // lookup this path already performs.
            batchYear: true,
            email: true,
            collegeEmail: true,
          },
        }),
      ]);

      if (!activity || activity.deletedAt) {
        return {
          allowed: false,
          code: 'NOT_FOUND',
          reason: 'Activity not found',
        };
      }
      return this.activityPolicy.canView(
        user
          ? {
              id: user.id,
              collegeId: user.collegeId,
              batchYear: this.studentYearPolicy.getUserBatchYear(user),
            }
          : null,
        activity,
      );
    } catch (err) {
      this.logger.warn(
        `activity room access check failed: ${errorMessage(err)}`,
      );
      // Fail closed.
      return {
        allowed: false,
        code: 'NOT_FOUND',
        reason: 'Activity not found',
      };
    }
  }

  /**
   * A visibility change re-runs authorization for everyone currently subscribed
   * to the activity room and evicts whoever just lost access, so a socket opened
   * while the activity was PUBLIC cannot keep streaming it after it turns
   * COLLEGE_ONLY or PRIVATE.
   */
  private async revalidateActivityRoom(activityId: string) {
    const room = this.server?.sockets?.adapter?.rooms?.get(
      `activity_${activityId}`,
    );
    if (!room || room.size === 0) return;

    for (const socketId of Array.from(room)) {
      const socket = this.server.sockets.sockets.get(socketId);
      const userId = socket ? socket.data.userId : null;
      if (!socket) continue;
      if (!userId) {
        void socket.leave(`activity_${activityId}`);
        continue;
      }
      const decision = await this.checkActivityRoomAccess(userId, activityId);
      if (!decision.allowed) {
        void socket.leave(`activity_${activityId}`);
        socket.emit('activity:access_revoked', {
          activityId,
          code: decision.code,
          message: decision.reason,
        });
      }
    }
  }

  @SubscribeMessage('activity:leave')
  handleActivityLeave(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const parsed = parseSocketPayload(ActivityRoomPayload, data);
    if (!parsed.ok) return INVALID_PAYLOAD;
    void client.leave(`activity_${parsed.value.activityId}`);
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const userId = client.data.userId;
    const userName = client.data.userName || 'Someone';
    const parsed = parseSocketPayload(ConversationRefPayload, data);
    if (!userId || !parsed.ok) return;
    const { conversationId } = parsed.value;
    // Ephemeral: dropped in silence, never acked with an error.
    if (!this.allowEphemeral(`typing:${userId}:${conversationId}`, 15, 10_000))
      return;
    // A typing indicator is a message-composer signal. Silently dropping it
    // (rather than throwing) keeps a stale client from spraying error acks
    // while it is refused; the composer it came from is already disabled.
    if (!(await this.verificationAccess.isUserEligible(userId))) return;
    const conv = await this.conversationForParticipant(userId, conversationId);
    if (!conv) return;
    this.emitToConversationRooms(conv, 'typing:start', {
      conversationId,
      userId,
      userName,
    });
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const userId = client.data.userId;
    const parsed = parseSocketPayload(ConversationRefPayload, data);
    if (!userId || !parsed.ok) return;
    const { conversationId } = parsed.value;
    if (!this.allowEphemeral(`typing:${userId}:${conversationId}`, 15, 10_000))
      return;
    const conv = await this.conversationForParticipant(userId, conversationId);
    if (!conv) return;
    this.emitToConversationRooms(conv, 'typing:stop', {
      conversationId,
      userId,
    });
  }

  // Still emitted by older installed app builds; kept as an alias.
  @SubscribeMessage('message:received')
  async handleMessageReceived(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    return this.handleMessageDeliveredInternal(client, data);
  }

  @SubscribeMessage('message:delivered')
  async handleMessageDelivered(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    return this.handleMessageDeliveredInternal(client, data);
  }

  private async handleMessageDeliveredInternal(
    client: AppSocket,
    data: unknown,
  ) {
    const userId = client.data.userId;
    const parsed = parseSocketPayload(DeliveryReceiptPayload, data);
    if (!userId || !parsed.ok) return;
    const { conversationId, messageId } = parsed.value;
    // Only a participant may report delivery into a conversation; anyone else
    // could otherwise inject receipts into conversations they are not in.
    const conv = await this.conversationForParticipant(userId, conversationId);
    if (!conv) return;
    this.emitToConversationRooms(conv, 'message:delivered', {
      conversationId,
      messageId,
      deliveredTo: userId,
      deliveredAt: new Date().toISOString(),
    });
  }

  @SubscribeMessage('messages:seen')
  async handleMessagesSeen(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    return this.handleSeenInternal(client, data);
  }

  @SubscribeMessage('conversation:mark_seen')
  async handleMarkSeen(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    return this.handleSeenInternal(client, data);
  }

  private async handleSeenInternal(client: AppSocket, data: unknown) {
    try {
      const readerId = client.data.userId;
      const parsed = parseSocketPayload(SeenPayload, data);
      if (!readerId || !parsed.ok) return;
      const { conversationId, lastMessageId } = parsed.value;

      // A non-participant must neither mark nor announce a read.
      const conv = await this.conversationForParticipant(
        readerId,
        conversationId,
      );
      if (!conv) return;

      // Single DB write regardless of which event name the client used
      await this.messagesService.markAsRead(conv.id, readerId);
      const payload = {
        conversationId,
        lastMessageId,
        readerId,
        lastReadAt: new Date().toISOString(),
      };
      this.emitToConversationRooms(conv, 'messages:seen', payload);
      this.emitToConversationRooms(conv, 'conversation:seen', payload);
    } catch {
      // Ignore transient pool timeouts or seen processing failures
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() _client: AppSocket) {
    return { event: 'pong', timestamp: Date.now() };
  }

  /**
   * The conversation `ref` (internal or public id) names, if `userId` is an
   * active participant of it; otherwise null. One indexed query answers both
   * "which conversation" and "are you in it", so a client cannot address a
   * conversation it only knows the id of. Fails closed on a lookup error.
   */
  private async conversationForParticipant(
    userId: string,
    ref: string,
  ): Promise<{ id: string; publicId: string | null } | null> {
    const key = `${userId}:${ref}`;
    const now = Date.now();
    const hit = this.participantConvCache.get(key);
    if (hit && hit.expiresAt > now) return hit.conv;

    let conv: { id: string; publicId: string | null } | null;
    try {
      conv = await this.prisma.conversation.findFirst({
        where: {
          OR: [{ id: ref }, { publicId: ref }],
          participants: { some: { userId, deletedAt: null, leftAt: null } },
        },
        select: { id: true, publicId: true },
      });
    } catch (err) {
      this.logger.warn(`participant lookup failed: ${errorMessage(err)}`);
      return null;
    }

    if (
      this.participantConvCache.size >= RealtimeGateway.PARTICIPANT_CACHE_MAX
    ) {
      const oldest = this.participantConvCache.keys().next();
      if (!oldest.done) this.participantConvCache.delete(oldest.value);
    }
    this.participantConvCache.set(key, {
      conv,
      expiresAt:
        now +
        (conv
          ? RealtimeGateway.PARTICIPANT_HIT_TTL_MS
          : RealtimeGateway.PARTICIPANT_MISS_TTL_MS),
    });
    return conv;
  }

  /**
   * Emits to both room names a conversation is joined under. One `to([...])`
   * call, so a socket in both rooms receives the event once.
   */
  private emitToConversationRooms(
    conv: { id: string; publicId: string | null },
    event: string,
    payload: object,
  ) {
    const rooms = [conv.id, conv.publicId]
      .filter((r): r is string => Boolean(r))
      .map((r) => `conv_${r}`);
    this.server.to(rooms).emit(event, payload);
  }

  // One of the two database-heavy events that fire on every reconnect, which
  // is what turns a mass disconnect into a thundering herd against Postgres.
  @SubscribeMessage('conversation:join_rooms')
  async handleJoinRooms(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const parsed = parseSocketPayload(JoinRoomsPayload, data);
    if (!parsed.ok) return INVALID_PAYLOAD;
    const { conversationIds } = parsed.value;
    const userId = client.data.userId;
    if (userId) {
      const limited = await this.limitEvent(userId, [
        { policy: 'socket.catchup.user', identifier: userId },
      ]);
      if (limited) return limited;
    }
    if (!userId) return;

    // Skip DB lookup if client is already joined to all requested rooms
    const unjoinedIds = conversationIds.filter(
      (id) => !client.rooms.has(`conv_${id}`),
    );
    if (unjoinedIds.length === 0) return;

    try {
      // Step 1: Indexed lookup on Conversation (id PK and publicId unique index)
      const matchingConvs = await this.prisma.conversation.findMany({
        where: {
          OR: [{ id: { in: unjoinedIds } }, { publicId: { in: unjoinedIds } }],
        },
        select: { id: true, publicId: true },
      });

      if (matchingConvs.length === 0) return;

      const validInternalIds = new Set(matchingConvs.map((c) => c.id));

      // Step 2: Fast indexed lookup on ConversationParticipant by (userId, conversationId)
      const validParticipants =
        await this.prisma.conversationParticipant.findMany({
          where: {
            userId,
            conversationId: { in: Array.from(validInternalIds) },
            deletedAt: null,
            leftAt: null,
          },
          select: { conversationId: true },
        });

      const allowedInternalIds = new Set(
        validParticipants.map((p) => p.conversationId),
      );

      matchingConvs.forEach((c) => {
        if (allowedInternalIds.has(c.id)) {
          if (c.id) void client.join(`conv_${c.id}`);
          if (c.publicId) void client.join(`conv_${c.publicId}`);
        }
      });
    } catch (err) {
      this.logger.error('Failed to verify room join authorization', err);
    }
  }

  @SubscribeMessage('community:join_room')
  async handleJoinCommunityRoom(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const parsed = parseSocketPayload(CommunityRoomPayload, data);
    if (!parsed.ok) return INVALID_PAYLOAD;
    const { communityId } = parsed.value;

    const userId = client.data.userId;
    if (userId) {
      const limited = await this.limitEvent(userId, [
        { policy: 'socket.roomjoin.user', identifier: userId },
      ]);
      if (limited) return limited;
    }

    // The room carries membership-change events for the community. A private
    // community's are not public information, and this took the id from the
    // client without checking anything at all — so any socket could name a
    // private community and watch its membership change in real time.
    const allowed = await this.checkCommunityRoomAccess(userId, communityId);
    if (!allowed) {
      void client.leave(`community_${communityId}`);
      return;
    }

    void client.join(`community_${communityId}`);

    // Answer with the count as it stands right now. The community payload the
    // page rendered from can be up to 60s stale (it is Redis-cached), and
    // presence moves far faster than that — so without this the viewer sits
    // on an old number until somebody happens to connect or disconnect.
    try {
      const online =
        await this.communitiesService.countOnlineMembers(communityId);
      client.emit('community:presence', {
        communityId: communityId,
        online,
      });
    } catch {
      // Non-fatal: the room join itself succeeded.
    }
  }

  /**
   * Server-side authorization for the `community_<id>` realtime room.
   *
   * A public community's activity is visible to anyone who can open it, so the
   * room follows: it needs the community to exist and not be deleted. A private
   * one additionally needs the viewer to actually be a member.
   */
  private async checkCommunityRoomAccess(
    userId: string | undefined,
    communityId: string,
  ): Promise<boolean> {
    if (!userId) return false;
    try {
      const community = await this.prisma.community.findFirst({
        where: { id: communityId, deletedAt: null },
        select: { id: true, isPrivate: true, ownerId: true },
      });
      if (!community) return false;
      if (!community.isPrivate) return true;
      if (community.ownerId === userId) return true;

      const membership = await this.prisma.communityMember.findFirst({
        where: { communityId, userId },
        select: { userId: true },
      });
      return Boolean(membership);
    } catch (err) {
      this.logger.error('Failed to authorize community room join', err);
      return false;
    }
  }

  @SubscribeMessage('community:leave_room')
  handleLeaveCommunityRoom(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const parsed = parseSocketPayload(CommunityRoomPayload, data);
    if (!parsed.ok) return INVALID_PAYLOAD;
    void client.leave(`community_${parsed.value.communityId}`);
  }

  // ─── Instant Match Socket Handlers ──────────────────────────────────────────
  //
  // Every handler returns an explicit ack. The client treats a missing or
  // error ack as a failed action, which is what stops a dropped emit from
  // leaving someone stuck on a "searching" screen that nothing will ever
  // resolve. Payloads are validated here — never trusted from the UI.

  private instantMatchAck(err: unknown, fallback: string) {
    // Nest HttpExceptions carry `status` and `response.message`.
    const e = isRecord(err) ? err : {};
    const response = isRecord(e.response) ? e.response : {};
    const status = e.status;
    const message = response.message ?? e.message;
    // Only surface messages we raised deliberately (4xx); anything else is an
    // internal fault and gets a generic message.
    if (
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      typeof message === 'string'
    ) {
      return { status: 'error' as const, error: message, code: status };
    }
    this.logger.error(
      `${fallback}: ${(err as Error)?.message}`,
      (err as Error)?.stack,
    );
    return { status: 'error' as const, error: fallback, code: 500 };
  }

  @SubscribeMessage('queue:join')
  @VerifiedOnly()
  async handleQueueJoin(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const userId = client.data.userId;
    if (!userId)
      return { status: 'error', error: 'Unauthenticated', code: 401 };

    // Per-minute burst, per-hour quota, and a per-address budget that catches
    // a farm of throwaway accounts behind one host.
    const joinLimited = await this.limitEvent(userId, [
      { policy: 'im.join.user', identifier: userId },
      { policy: 'im.join.hourly.user', identifier: userId },
      { policy: 'im.join.ip', identifier: socketIp(client) },
    ]);
    if (joinLimited) return joinLimited;

    try {
      const dto = parseJoinQueuePayload(userId, data);
      await this.instantMatchService.joinQueue(dto);
      return { status: 'ok' };
    } catch (err) {
      return this.instantMatchAck(err, 'Could not start your search');
    }
  }

  @SubscribeMessage('queue:cancel')
  async handleQueueCancel(@ConnectedSocket() client: AppSocket) {
    const userId = client.data.userId;
    if (!userId)
      return { status: 'error', error: 'Unauthenticated', code: 401 };
    try {
      await this.instantMatchService.cancelQueue(userId);
      return { status: 'ok' };
    } catch (err) {
      return this.instantMatchAck(err, 'Could not cancel your search');
    }
  }

  @SubscribeMessage('match:respond')
  @VerifiedOnly()
  async handleMatchRespond(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const userId = client.data.userId;
    if (!userId)
      return { status: 'error', error: 'Unauthenticated', code: 401 };

    const limited = await this.limitEvent(userId, [
      { policy: 'im.respond.user', identifier: userId },
    ]);
    if (limited) return limited;

    try {
      const { matchId, action } = parseMatchRespondPayload(data);
      await this.instantMatchService.respondToMatch(userId, matchId, action);
      return { status: 'ok' };
    } catch (err) {
      return this.instantMatchAck(err, 'Could not send your response');
    }
  }

  /**
   * Resync after a reload or a socket reconnect. The server is the source of
   * truth for whether this user is still queued or has a live match waiting,
   * so the client rebuilds from this rather than from its own stale memory.
   */
  @SubscribeMessage('queue:sync')
  @VerifiedOnly()
  async handleQueueSync(@ConnectedSocket() client: AppSocket) {
    const userId = client.data.userId;
    if (userId) {
      const limited = await this.limitEvent(userId, [
        { policy: 'im.queuesync.user', identifier: userId },
      ]);
      if (limited) return limited;
    }
    if (!userId)
      return { status: 'error', error: 'Unauthenticated', code: 401 };
    try {
      const state = await this.instantMatchService.getStateFor(userId);
      return { status: 'ok', state };
    } catch (err) {
      return this.instantMatchAck(err, 'Could not restore your search');
    }
  }

  /**
   * Who is searching right now — the first thing Instant Match shows.
   *
   * A read, like `queue:sync`, and answered the same way: the server builds
   * it per viewer (its own blocks and cooldowns apply) from the live queue
   * rows, so two people opening Instant Match at the same moment see the same
   * queue described honestly, minus whoever each of them cannot be paired
   * with. Clients re-read it when `queue:changed` says the queue moved.
   */
  @SubscribeMessage('queue:list')
  @VerifiedOnly()
  async handleQueueList(@ConnectedSocket() client: AppSocket) {
    const userId = client.data.userId;
    if (!userId)
      return { status: 'error', error: 'Unauthenticated', code: 401 };

    const limited = await this.limitEvent(userId, [
      { policy: 'im.queuelist.user', identifier: userId },
    ]);
    if (limited) return limited;

    try {
      const people = await this.instantMatchService.getSearchingNow(userId);
      return { status: 'ok', people };
    } catch (err) {
      return this.instantMatchAck(err, 'Could not load who is searching');
    }
  }

  /**
   * The authoritative state of this user's Instant Match chat.
   *
   * Every Instant Match screen calls this on mount, on reconnect, and on tab
   * focus. Realtime events are an optimisation on top of it, never the only
   * path to correctness — a user who was offline when the other person left
   * learns about it here.
   */
  @SubscribeMessage('instant_match:chat_state')
  @VerifiedOnly()
  async handleInstantMatchChatState(@ConnectedSocket() client: AppSocket) {
    const userId = client.data.userId;
    if (!userId)
      return { status: 'error', error: 'Unauthenticated', code: 401 };
    try {
      const state = await this.instantMatchService.getChatStateFor(userId);
      return { status: 'ok', state };
    } catch (err) {
      return this.instantMatchAck(err, 'Could not load your Instant Match');
    }
  }

  /**
   * "Find someone new": leave the current chat.
   *
   * Idempotent by construction — the service claims the transition with a
   * conditional update, so a double tap, two tabs, or both users leaving at
   * the same instant all converge on one ENDED_BY_USER row. A caller that
   * lost the race still gets `ok` with the resulting state rather than an
   * error, because from the user's point of view the chat did end.
   */
  @SubscribeMessage('instant_match:leave')
  @VerifiedOnly()
  async handleInstantMatchLeave(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() data: unknown,
  ) {
    const userId = client.data.userId;
    if (!userId)
      return { status: 'error', error: 'Unauthenticated', code: 401 };

    const limited = await this.limitEvent(userId, [
      { policy: 'im.respond.user', identifier: userId },
    ]);
    if (limited) return limited;

    try {
      const rawMatchId = isRecord(data) ? data.matchId : undefined;
      const matchId =
        typeof rawMatchId === 'string' ? rawMatchId.trim() : undefined;
      const result = await this.instantMatchService.leaveChatSession(
        userId,
        matchId || undefined,
      );
      return { status: 'ok', ended: result.ended, state: result.session };
    } catch (err) {
      return this.instantMatchAck(err, 'Could not leave this match');
    }
  }

  // ─── Instant Match Emit Helpers ──────────────────────────────────────────────
  // Emits target the user's personal room, so every device and tab that user
  // has open stays in step with the same match.

  emitMatchFound(userId: string, payload: MatchFoundPayload) {
    this.server?.to(userId).emit('match:found', payload);
  }

  emitMatchAccepted(userId: string, payload: MatchAcceptedPayload) {
    // Join every one of this user's live sockets to the new conversation's
    // rooms *before* announcing it. Room membership is otherwise established
    // by the client replaying its conversation list, so without this the two
    // freshly matched users sat in a chat that delivered nothing in real time
    // until one of them reloaded.
    const userSockets = this.server?.sockets.adapter.rooms.get(userId);
    if (userSockets) {
      for (const socketId of userSockets) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (!socket) continue;
        void socket.join(`conv_${payload.internalId}`);
        if (payload.chatId) void socket.join(`conv_${payload.chatId}`);
      }
    }
    this.server?.to(userId).emit('match:accepted', payload);
  }

  emitMatchDeclined(
    userId: string,
    payload: { reason: string; requeued: boolean },
  ) {
    this.server?.to(userId).emit('match:declined', payload);
  }

  emitSearchResumed(userId: string) {
    this.server?.to(userId).emit('search:resumed', {});
  }

  emitQueueStats(userId: string, stats: QueueStats) {
    this.server?.to(userId).emit('queue:stats', stats);
  }

  /**
   * Somebody joined, left, matched or expired out of the queue.
   *
   * Broadcast rather than aimed at a room, because the people who care are
   * whoever currently has the browse list on screen and the server has no way
   * to know who that is. It is deliberately payload-free: the roster is
   * viewer-scoped (blocks, cooldowns), so the only correct thing to push
   * everyone is the fact that it moved — each client re-reads its own.
   * Clients with the list closed have no listener registered and drop it.
   */
  emitQueueChanged() {
    this.server?.emit('queue:changed', {});
  }

  /**
   * A chat ended — because someone left, or because its 24h window closed.
   *
   * Targets the user's personal room, so every tab and device this person has
   * open transitions together; a second tab left on the old screen was one of
   * the ways stale state used to send a message into a dead chat. The payload
   * is the same viewer-scoped state object the resync endpoint returns, so a
   * client that receives this and a client that reloads land on identical
   * state — and applying it twice is a no-op.
   */
  emitInstantMatchChatEnded(userId: string, state: InstantMatchChatState) {
    this.server?.to(userId).emit('instant_match:chat_ended', state);
  }
}

/**
 * Reads the access token out of a raw Cookie header.
 *
 * Socket.IO hands the handshake headers through unparsed — `cookie-parser` is
 * Express middleware and never runs for a WebSocket upgrade — so this does the
 * one lookup it needs rather than pulling in a parser for it.
 */
function cookieValue(
  headers: IncomingHttpHeaders | undefined,
  name: string,
): string {
  const raw = headers?.cookie;
  if (typeof raw !== 'string' || !raw) return '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return '';
}

function cookieToken(headers: IncomingHttpHeaders | undefined): string {
  return cookieValue(headers, USER_ACCESS_COOKIE);
}
