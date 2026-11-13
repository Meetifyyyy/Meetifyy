import type Redis from 'ioredis';
import { stub } from '../common/testing/stub';
import {
  SOCKET_RELAY_CHANNEL,
  SocketRelay,
  parseRelayMessage,
  type RelayOp,
} from './socket-relay';
import { buildGateway } from './testing/gateway.fixture';
import type { RealtimeGateway } from './realtime.gateway';

type Listener = (channel: string, message: string) => void;
type Handler = (...args: string[]) => void;

/**
 * An in-memory stand-in for one Redis server: every connection subscribed to
 * a channel hears every publish on it, the publisher's own included, and
 * delivery is asynchronous — as with real pub/sub. A connection can drop and
 * come back (`close`/`ready`), and its SUBSCRIBE acknowledgements can be held
 * back to reproduce the reconnect race.
 */
class FakeRedisServer {
  private readonly subscribers = new Map<string, Set<Listener>>();
  published = 0;

  connection(status: Redis['status'] = 'ready') {
    const handlers = new Map<string, Set<Handler>>();
    let current = status;
    let holdAcks = false;
    const heldAcks: Array<() => void> = [];
    const fire = (event: string, ...args: string[]) =>
      handlers.get(event)?.forEach((h) => h(...args));
    const dispatch: Listener = (ch, msg) => fire('message', ch, msg);
    const redis: Redis = stub<Redis>({
      get status() {
        return current;
      },
      on: jest.fn((event: string, handler: Handler): Redis => {
        const set = handlers.get(event) ?? new Set<Handler>();
        set.add(handler);
        handlers.set(event, set);
        return redis;
      }),
      off: jest.fn((event: string, handler: Handler): Redis => {
        handlers.get(event)?.delete(handler);
        return redis;
      }),
      subscribe: jest.fn((channel: string) => {
        const ack = () => {
          const set = this.subscribers.get(channel) ?? new Set<Listener>();
          set.add(dispatch);
          this.subscribers.set(channel, set);
        };
        if (!holdAcks) {
          ack();
          return Promise.resolve(1);
        }
        return new Promise<number>((resolve) =>
          heldAcks.push(() => {
            ack();
            resolve(1);
          }),
        );
      }),
      publish: jest.fn((channel: string, message: string) => {
        this.published += 1;
        const set = this.subscribers.get(channel) ?? new Set<Listener>();
        setTimeout(() => set.forEach((l) => l(channel, message)), 0);
        return Promise.resolve(set.size);
      }),
    });
    return {
      redis,
      setStatus: (s: Redis['status']) => (current = s),
      /** The connection drops: the server forgets its subscriptions. */
      drop: () => {
        current = 'reconnecting';
        this.subscribers.forEach((set) => set.delete(dispatch));
        fire('close');
      },
      /** Reconnected; SUBSCRIBE acks are held until `releaseAcks`. */
      reconnect: () => {
        holdAcks = true;
        current = 'ready';
        fire('ready');
      },
      releaseAcks: () => {
        holdAcks = false;
        heldAcks.splice(0).forEach((ack) => ack());
      },
      listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
    };
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function replica(server: FakeRedisServer) {
  const delivered: RelayOp[][] = [];
  const pub = server.connection();
  const sub = server.connection();
  const logger = { error: jest.fn() };
  const relay = new SocketRelay({
    deliverLocally: (ops) => delivered.push(ops),
    getPubClient: () => pub.redis,
    getSubClient: () => sub.redis,
    logger,
  });
  return { relay, delivered, pub, sub, logger };
}

const op: RelayOp = {
  kind: 'emit',
  rooms: ['user-b'],
  event: 'message:new',
  payload: { id: 'm1', alert: true },
};

describe('SocketRelay across replicas', () => {
  it('delivers an operation exactly once on every replica, the sender included', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    const b = replica(redis);
    a.relay.start();
    b.relay.start();
    await flush();

    a.relay.send([op]);
    await flush();

    expect(redis.published).toBe(1);
    expect(a.delivered).toEqual([[op]]);
    expect(b.delivered).toEqual([[op]]);
  });

  it('keeps the operations of one send together and in order', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    const b = replica(redis);
    a.relay.start();
    b.relay.start();
    await flush();

    const join: RelayOp = { kind: 'join', room: 'user-b', join: ['conv_1'] };
    a.relay.send([join, op]);
    await flush();

    expect(b.delivered).toEqual([[join, op]]);
  });

  it('delivers locally, without publishing, until its own subscription is confirmed', () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    // start() not called: this replica could not hear its own publish yet.
    a.relay.send([op]);

    expect(redis.published).toBe(0);
    expect(a.delivered).toEqual([[op]]);
  });

  it('delivers locally when the subscriber connection is not ready', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    a.sub.setStatus('reconnecting');

    a.relay.send([op]);

    expect(redis.published).toBe(0);
    expect(a.delivered).toEqual([[op]]);
  });

  it('delivers locally, once, when the publish fails', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    jest
      .mocked(a.pub.redis.publish)
      .mockRejectedValueOnce(new Error('connection lost'));

    a.relay.send([op]);
    await flush();

    expect(a.delivered).toEqual([[op]]);
    expect(a.logger.error).toHaveBeenCalled();
  });

  it('delivers locally without Redis at all', () => {
    const delivered: RelayOp[][] = [];
    const relay = new SocketRelay({
      deliverLocally: (ops) => delivered.push(ops),
      getPubClient: () => null,
      getSubClient: () => null,
      logger: { error: jest.fn() },
    });
    relay.start();
    relay.send([op]);
    expect(delivered).toEqual([[op]]);
  });

  it('does not publish after a reconnect until its resubscribe is acknowledged', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    const b = replica(redis);
    a.relay.start();
    b.relay.start();
    await flush();

    a.sub.drop();
    a.sub.reconnect(); // "ready", but SUBSCRIBE not yet acknowledged
    a.relay.send([op]);
    await flush();
    // Delivered on A directly; not published, so nothing is lost for A.
    expect(redis.published).toBe(0);
    expect(a.delivered).toEqual([[op]]);

    a.sub.releaseAcks();
    await flush();
    a.relay.send([op]);
    await flush();
    expect(redis.published).toBe(1);
    expect(a.delivered).toEqual([[op], [op]]);
    expect(b.delivered).toEqual([[op]]);
  });

  it('detaches from the shared subscriber on stop', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    expect(a.sub.listenerCount('message')).toBe(1);

    a.relay.stop();
    expect(a.sub.listenerCount('message')).toBe(0);
    expect(a.sub.listenerCount('ready')).toBe(0);
    a.relay.send([op]);
    expect(redis.published).toBe(0);
    expect(a.delivered).toEqual([[op]]);
  });

  it('subscribes once even if started twice', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    a.relay.start();
    await flush();
    expect(a.sub.listenerCount('message')).toBe(1);
  });

  it('does not throw into the caller for a payload JSON cannot encode', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    const bad: RelayOp = { ...op, payload: { n: BigInt(1) } };

    expect(() => a.relay.send([bad])).not.toThrow();
    expect(redis.published).toBe(0);
    expect(a.logger.error).toHaveBeenCalled();
  });

  it('handles a publish once even when Redis delivers it twice (an ioredis resend)', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    const b = replica(redis);
    a.relay.start();
    b.relay.start();
    await flush();
    const publish = jest.mocked(a.pub.redis.publish);

    a.relay.send([op]);
    await flush();
    // Replay exactly what went over the wire, as a resend after reconnect would.
    const [channel, wire] = publish.mock.calls[0];
    await publish(String(channel), String(wire));
    await flush();

    expect(a.delivered).toEqual([[op]]);
    expect(b.delivered).toEqual([[op]]);
  });

  it('gives every publish its own id', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    a.relay.send([op]);
    a.relay.send([op]);
    const ids = jest
      .mocked(a.pub.redis.publish)
      .mock.calls.map(([, wire]) => parseRelayMessage(String(wire)).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('still delivers a message without an id (an older build mid-deploy)', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    const wire = JSON.stringify({ ops: [op] });
    await a.pub.redis.publish(SOCKET_RELAY_CHANNEL, wire);
    await a.pub.redis.publish(SOCKET_RELAY_CHANNEL, wire);
    await flush();
    expect(a.delivered).toEqual([[op], [op]]);
  });

  it('does not deliver twice when a publish reported failure but reached Redis', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    const publish = jest.mocked(a.pub.redis.publish);
    const real = publish.getMockImplementation();
    // Redis received it, but the client saw the connection die first.
    publish.mockImplementationOnce((channel, wire) => {
      void real?.(channel, wire);
      return Promise.reject(new Error('Connection is closed'));
    });

    a.relay.send([op]);
    await flush();

    expect(a.delivered).toEqual([[op]]);
  });

  it('ignores messages on other channels', async () => {
    const redis = new FakeRedisServer();
    const a = replica(redis);
    a.relay.start();
    await flush();
    await a.pub.redis.publish('meetifyy:domain_events', '{"ops":[]}');
    await flush();
    expect(a.delivered).toEqual([]);
  });
});

describe('parseRelayMessage', () => {
  it('keeps valid operations in order and drops malformed ones', () => {
    const raw = JSON.stringify({
      ops: [
        { kind: 'join', room: 'u1', join: ['conv_1'] },
        { kind: 'emit', rooms: 'not-an-array', event: 'x' },
        { kind: 'unknown' },
        { kind: 'emit', rooms: [], event: 'queue:changed', payload: {} },
        { kind: 'emit', rooms: ['u1'], except: [1], event: 'x' },
      ],
    });
    expect(parseRelayMessage(raw).ops).toEqual([
      { kind: 'join', room: 'u1', join: ['conv_1'] },
      { kind: 'emit', rooms: [], event: 'queue:changed', payload: {} },
    ]);
  });

  it('yields nothing for non-JSON or a missing ops list', () => {
    expect(parseRelayMessage('not json')).toEqual({ id: null, ops: [] });
    expect(parseRelayMessage('{"op":[]}')).toEqual({ id: null, ops: [] });
  });

  it('reads the message id, and treats a missing or empty one as none', () => {
    expect(parseRelayMessage('{"id":"m-1","ops":[]}').id).toBe('m-1');
    expect(parseRelayMessage('{"ops":[]}').id).toBeNull();
    expect(parseRelayMessage('{"id":"","ops":[]}').id).toBeNull();
    expect(parseRelayMessage('{"id":7,"ops":[]}').id).toBeNull();
  });

  it('uses the channel name the gateway subscribes to', () => {
    expect(SOCKET_RELAY_CHANNEL).toBe('meetifyy:socket_relay');
  });
});

describe('RealtimeGateway relay delivery', () => {
  type Call = string;

  function gatewayWithServer() {
    const calls: Call[] = [];
    const gateway = buildGateway();
    gateway.server = stub<RealtimeGateway['server']>({
      to: (rooms: string | string[]) => ({
        emit: jest.fn((event: string) => {
          if (String(rooms) === 'boom') throw new Error('reserved');
          calls.push(`to(${String(rooms)}).emit(${event})`);
          return true;
        }),
        except: (except: string | string[]) => ({
          emit: jest.fn((event: string) => {
            calls.push(
              `to(${String(rooms)}).except(${String(except)}).emit(${event})`,
            );
            return true;
          }),
        }),
      }),
      in: (room: string | string[]) => ({
        socketsJoin: jest.fn((join: string | string[]) => {
          calls.push(`in(${String(room)}).socketsJoin(${String(join)})`);
        }),
      }),
      emit: jest.fn((event: string) => {
        calls.push(`emit(${event})`);
        return true;
      }),
    });
    return { gateway, calls };
  }

  it('joins the matched user to the chat before announcing the match', () => {
    const { gateway, calls } = gatewayWithServer();
    gateway.emitMatchAccepted(
      'user-1',
      stub<Parameters<RealtimeGateway['emitMatchAccepted']>[1]>({
        internalId: 'c1',
        chatId: 'pub1',
      }),
    );
    expect(calls).toEqual([
      'in(user-1).socketsJoin(conv_c1,conv_pub1)',
      'to(user-1).emit(match:accepted)',
    ]);
  });

  it('keeps delivering the rest of a batch when one operation throws', () => {
    const { gateway, calls } = gatewayWithServer();
    gateway['deliverRelayOps']([
      { kind: 'emit', rooms: ['boom'], event: 'x', payload: {} },
      { kind: 'emit', rooms: ['user-2'], event: 'y', payload: {} },
    ]);
    expect(calls).toEqual(['to(user-2).emit(y)']);
  });

  it('excludes the sending socket when asked to', () => {
    const { gateway, calls } = gatewayWithServer();
    gateway['deliverRelayOps']([
      {
        kind: 'emit',
        rooms: ['user-1'],
        except: ['sock-1'],
        event: 'message:new',
        payload: {},
      },
    ]);
    expect(calls).toEqual(['to(user-1).except(sock-1).emit(message:new)']);
  });

  it('tells every screen of the person who accepted to show the wait (IM-19)', () => {
    const { gateway, calls } = gatewayWithServer();
    gateway.emitMatchWaiting('user-1', { matchId: 'm1' });
    expect(calls).toEqual(['to(user-1).emit(match:waiting)']);
  });

  it('tells only the sockets that read the roster that the queue moved', () => {
    const { gateway, calls } = gatewayWithServer();
    gateway.emitQueueChanged();
    expect(calls).toEqual(['to(im:roster).emit(queue:changed)']);
  });

  it('sends grouped queue stats to each person, skipping an empty group', () => {
    const { gateway, calls } = gatewayWithServer();
    const stats = { count: 3, sameActivity: 2, avgWaitSecs: 40 };
    gateway.emitQueueStatsMany([
      { userIds: ['u1', 'u2'], stats },
      { userIds: [], stats },
      { userIds: ['u3'], stats: { ...stats, sameActivity: 1 } },
    ]);
    expect(calls).toEqual([
      'to(u1,u2).emit(queue:stats)',
      'to(u3).emit(queue:stats)',
    ]);
  });
});

describe('RealtimeGateway domain-event subscriber', () => {
  it('handles a re-sent domain event once and never forwards the transport id', async () => {
    const redis = new FakeRedisServer();
    const sub = redis.connection();
    const pub = redis.connection();
    const gateway = buildGateway({
      redis: { getSubClient: () => sub.redis, getPubClient: () => pub.redis },
    });
    const handled = jest.fn<void, [unknown]>();
    gateway['handleDomainEvent'] = handled;
    gateway['setupDomainEventSubscriber']();

    const wire = JSON.stringify({
      type: 'follow.created',
      timestamp: 't',
      data: { userId: 'u1' },
      eventId: 'e-1',
    });
    await pub.redis.publish('meetifyy:domain_events', wire);
    await pub.redis.publish('meetifyy:domain_events', wire);
    // An older publisher, without an id, is handled every time.
    const legacy = JSON.stringify({ type: 'x', timestamp: 't', data: {} });
    await pub.redis.publish('meetifyy:domain_events', legacy);
    await flush();

    expect(handled).toHaveBeenCalledTimes(2);
    expect(handled).toHaveBeenNthCalledWith(1, {
      type: 'follow.created',
      timestamp: 't',
      data: { userId: 'u1' },
    });
    expect(handled).toHaveBeenNthCalledWith(2, {
      type: 'x',
      timestamp: 't',
      data: {},
    });
  });
});
