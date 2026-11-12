import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { isRecord } from '../common/utils/type-guards.util';
import {
  SeenMessageIds,
  newMessageId,
} from '../common/utils/pubsub-dedupe.util';

/**
 * Cluster-wide socket delivery for emits that do not come from a domain event.
 *
 * Domain events already reach every replica: DomainEventService publishes them
 * on Redis and each replica's gateway delivers them to the sockets it holds.
 * That is why this app does not use the Socket.IO Redis adapter — with it,
 * every replica handling the same event would broadcast it to the whole
 * cluster, and each user would receive it once per replica.
 *
 * Some emits do not go through that bus. A socket handler (`message:send`,
 * typing, receipts), the instant-match service and a presence change all run
 * on ONE replica, and a plain `server.to(room).emit()` there only reaches the
 * sockets that replica happens to hold. With more than one replica, everyone
 * connected elsewhere misses them.
 *
 * The relay closes that gap the same way the domain-event bus works: publish
 * the operation once, and let every replica — this one included — apply it to
 * its own sockets. Each socket lives on exactly one replica, so it receives the
 * operation exactly once.
 *
 * Without a ready Redis connection (local dev, Redis down), operations are
 * applied locally and immediately, which is the single-replica behaviour this
 * replaces. The relay never drops an operation because Redis is unavailable.
 */

export const SOCKET_RELAY_CHANNEL = 'meetifyy:socket_relay';

/** Emit `event` to the sockets in `rooms` (all sockets when `rooms` is empty),
 *  minus any in `except` (room names; a socket id is also a room). */
export interface RelayEmit {
  kind: 'emit';
  rooms: string[];
  except?: string[];
  event: string;
  payload: unknown;
}

/** Add every socket in `room` (typically a user's personal room) to `join`. */
export interface RelayJoin {
  kind: 'join';
  room: string;
  join: string[];
}

export type RelayOp = RelayEmit | RelayJoin;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function readOp(v: unknown): RelayOp | null {
  if (!isRecord(v)) return null;
  if (v.kind === 'emit') {
    if (!isStringArray(v.rooms) || typeof v.event !== 'string') return null;
    if (v.except !== undefined && !isStringArray(v.except)) return null;
    return {
      kind: 'emit',
      rooms: v.rooms,
      ...(v.except ? { except: v.except } : {}),
      event: v.event,
      payload: v.payload,
    };
  }
  if (v.kind === 'join') {
    if (typeof v.room !== 'string' || !isStringArray(v.join)) return null;
    return { kind: 'join', room: v.room, join: v.join };
  }
  return null;
}

export interface RelayMessage {
  /** Set by every current publisher; absent only from an older build. */
  id: string | null;
  ops: RelayOp[];
}

/** Parses a relay message. Anything malformed yields no operations. */
export function parseRelayMessage(raw: string): RelayMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { id: null, ops: [] };
  }
  if (!isRecord(data) || !Array.isArray(data.ops)) return { id: null, ops: [] };
  const ops: RelayOp[] = [];
  for (const candidate of data.ops) {
    const op = readOp(candidate);
    if (op) ops.push(op);
  }
  const id = typeof data.id === 'string' && data.id ? data.id : null;
  return { id, ops };
}

export interface SocketRelayDeps {
  /** Applies operations to the sockets held by THIS replica. */
  deliverLocally: (ops: RelayOp[]) => void;
  getPubClient: () => Redis | null;
  getSubClient: () => Redis | null;
  logger: Pick<Logger, 'error'>;
}

export class SocketRelay {
  /**
   * True only while this replica is known to be subscribed. Cleared when the
   * subscriber connection drops, and set again only once a SUBSCRIBE issued
   * after the reconnect has been acknowledged: ioredis reports the connection
   * `ready` and re-sends its subscriptions at the same moment, without waiting
   * for them, so `status === 'ready'` alone would let a publish race ahead of
   * the resubscribe and this replica would miss its own message.
   */
  private subscribed = false;
  private sub: Redis | null = null;
  private readonly seen = new SeenMessageIds();

  private readonly onMessage = (channel: string, message: string): void => {
    if (channel !== SOCKET_RELAY_CHANNEL) return;
    const { id, ops } = parseRelayMessage(message);
    // A repeat is a publish ioredis re-sent after a reconnect; see
    // pubsub-dedupe.util.ts. Messages without an id (an older build mid-deploy)
    // are delivered as before.
    if (id && !this.seen.firstSighting(id)) return;
    if (ops.length > 0) this.deliver(ops);
  };

  private readonly onDisconnected = (): void => {
    this.subscribed = false;
  };

  private readonly onReady = (): void => {
    this.confirmSubscription();
  };

  constructor(private readonly deps: SocketRelayDeps) {}

  /**
   * Subscribes to the relay channel. Until the subscription is confirmed,
   * operations are applied locally — publishing before this replica can hear
   * its own messages would drop them for its own sockets.
   */
  start(): void {
    if (this.sub) return;
    const sub = this.deps.getSubClient();
    if (!sub) return;
    this.sub = sub;
    sub.on('message', this.onMessage);
    sub.on('close', this.onDisconnected);
    sub.on('end', this.onDisconnected);
    sub.on('ready', this.onReady);
    this.confirmSubscription();
  }

  /** Detaches from the shared subscriber connection (module shutdown). */
  stop(): void {
    const sub = this.sub;
    if (!sub) return;
    sub.off('message', this.onMessage);
    sub.off('close', this.onDisconnected);
    sub.off('end', this.onDisconnected);
    sub.off('ready', this.onReady);
    this.sub = null;
    this.subscribed = false;
  }

  private confirmSubscription(): void {
    const sub = this.sub;
    if (!sub) return;
    // Re-subscribing to a channel this connection already has is a no-op on
    // the server; the acknowledgement is what proves the subscription is live.
    Promise.resolve(sub.subscribe(SOCKET_RELAY_CHANNEL)).then(
      () => {
        if (this.sub === sub) this.subscribed = true;
      },
      (err: unknown) => {
        this.deps.logger.error(
          'Could not subscribe to the socket relay; emits stay on this replica',
          err,
        );
      },
    );
  }

  /** True when a publish will come back to every replica, this one included. */
  private canPublish(pub: Redis | null): pub is Redis {
    return (
      this.subscribed &&
      pub !== null &&
      pub.status === 'ready' &&
      this.sub !== null &&
      this.sub.status === 'ready'
    );
  }

  /**
   * Delivers `ops`, in order, to every replica. Operations sent in one call
   * stay together and in order (a join before the emit that depends on it).
   * Exactly once per socket: each message carries an id and a replica handles
   * an id once, so a publish ioredis re-sends after a reconnect is dropped.
   */
  send(ops: RelayOp[]): void {
    if (ops.length === 0) return;
    const pub = this.deps.getPubClient();
    if (!this.canPublish(pub)) {
      this.deliver(ops);
      return;
    }
    const id = newMessageId();
    let message: string;
    try {
      message = JSON.stringify({ id, ops });
    } catch (err) {
      // Not serialisable (a cycle, a BigInt). A direct emit would fail on
      // the same value, so log it once and try locally rather than throw
      // into the caller, which has already committed its write.
      this.deps.logger.error('Socket relay payload is not serialisable', err);
      this.deliver(ops);
      return;
    }
    pub.publish(SOCKET_RELAY_CHANNEL, message).catch((err: unknown) => {
      // Not published, so no other replica has it. Deliver here so this
      // replica's sockets at least get it — the single-replica behaviour.
      this.deps.logger.error(
        `Socket relay publish failed; delivered ${ops.length} op(s) on this replica only`,
        err,
      );
      // Should the publish have reached Redis after all, its echo is a
      // repeat of what is delivered here.
      this.seen.firstSighting(id);
      this.deliver(ops);
    });
  }

  private deliver(ops: RelayOp[]): void {
    try {
      this.deps.deliverLocally(ops);
    } catch (err) {
      this.deps.logger.error('Socket relay delivery failed', err);
    }
  }
}
