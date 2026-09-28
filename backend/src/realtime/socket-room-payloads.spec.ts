import type { RealtimeGateway } from './realtime.gateway';
import { buildGateway, fakeSocket } from './testing/gateway.fixture';
import type { Stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessagesService } from '../messages/messages.service';
import type { ActivityAuthorizationService } from '../activities/activity-authorization.service';
import type { CommunitiesService } from '../communities/communities.service';
import type { BlocksService } from '../users/blocks.service';

/**
 * The last eight socket events that trusted their declared payload type
 * (pending item A1): the room joins and leaves, `conversation:join_rooms` and
 * `message:catchup`. `data: { postId?: string }` checks nothing at runtime, so
 * an object, array or number reached the access checks and the room name.
 *
 * Each is now parsed with parseSocketPayload. A malformed payload is answered
 * with an error ack before any dependency is touched. Every dependency here
 * records any use at all, so "touched nothing" is checked, not assumed.
 */
type Touched = string[];

/** A dependency that records every member read, at any depth. */
function recorder<T extends object>(name: string, touched: Touched): T {
  const handler: ProxyHandler<object> = {
    get: (_target, prop) => {
      if (prop === 'then') return undefined;
      touched.push(`${name}.${String(prop)}`);
      return new Proxy(() => Promise.resolve(null), handler);
    },
    apply: () => Promise.resolve(null),
  };
  return new Proxy({}, handler) as T;
}

const build = () => {
  const touched: Touched = [];
  const gateway = buildGateway({
    prisma: recorder<Stub<PrismaService>>('prisma', touched),
    messages: recorder<Stub<MessagesService>>('messages', touched),
    activityPolicy: recorder<Stub<ActivityAuthorizationService>>(
      'activityPolicy',
      touched,
    ),
    communities: recorder<Stub<CommunitiesService>>('communities', touched),
    blocks: recorder<Stub<BlocksService>>('blocks', touched),
  });
  const socket = fakeSocket({
    id: 'sock-1',
    data: { userId: 'user-1', userName: 'User' },
    rooms: new Set<string>(),
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
  });
  return { gateway, socket, touched };
};

type Handler = (
  g: RealtimeGateway,
  s: ReturnType<typeof build>['socket'],
  data: unknown,
) => unknown;

const events: [string, string, Handler][] = [
  ['message:catchup', 'since', (g, s, d) => g.handleMessageCatchup(s, d)],
  ['post:join', 'postId', (g, s, d) => g.handlePostJoin(s, d)],
  ['post:leave', 'postId', (g, s, d) => g.handlePostLeave(s, d)],
  ['activity:join', 'activityId', (g, s, d) => g.handleActivityJoin(s, d)],
  ['activity:leave', 'activityId', (g, s, d) => g.handleActivityLeave(s, d)],
  [
    'community:join_room',
    'communityId',
    (g, s, d) => g.handleJoinCommunityRoom(s, d),
  ],
  [
    'community:leave_room',
    'communityId',
    (g, s, d) => g.handleLeaveCommunityRoom(s, d),
  ],
  [
    'conversation:join_rooms',
    'conversationIds',
    (g, s, d) => g.handleJoinRooms(s, d),
  ],
];

const hostileValues: unknown[] = [{ not: '' }, 42, '', 'x'.repeat(500), null];
const hostileLists: unknown[] = [
  'conv-1',
  [{ not: '' }],
  [42],
  [''],
  ['x'.repeat(500)],
  Array.from({ length: 1001 }, (_, i) => `conv-${i}`),
];

describe.each(events)('%s', (_event, field, handle) => {
  const values = field === 'conversationIds' ? hostileLists : hostileValues;

  it.each(values.map((v) => [JSON.stringify(v).slice(0, 40), v]))(
    'refuses %s with an error ack, touching nothing',
    async (_label, value) => {
      const { gateway, socket, touched } = build();
      const ack = await handle(gateway, socket, { [field]: value });
      expect(ack).toMatchObject({ status: 'error' });
      expect(touched).toEqual([]);
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.leave).not.toHaveBeenCalled();
    },
  );

  it.each([[null], ['not-an-object'], [['array']]])(
    'refuses a payload of %j',
    async (payload) => {
      const { gateway, socket, touched } = build();
      expect(await handle(gateway, socket, payload)).toMatchObject({
        status: 'error',
      });
      expect(touched).toEqual([]);
    },
  );
});

describe('valid payloads still reach the handler', () => {
  it('leaves the rooms it is asked to leave', () => {
    const { gateway, socket } = build();
    gateway.handlePostLeave(socket, { postId: 'p1' });
    gateway.handleActivityLeave(socket, { activityId: 'a1' });
    gateway.handleLeaveCommunityRoom(socket, { communityId: 'c1' });
    expect(socket.leave.mock.calls).toEqual([
      ['post_p1'],
      ['activity_a1'],
      ['community_c1'],
    ]);
  });

  it('asks for catch-up since the timestamp it was given', async () => {
    const getCatchupMessages = jest.fn(() => Promise.resolve([]));
    const gateway = buildGateway({ messages: { getCatchupMessages } });
    const socket = fakeSocket({ data: { userId: 'user-1' } });
    await expect(
      gateway.handleMessageCatchup(socket, {
        since: '2026-09-28T10:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'ok', messages: [] });
    expect(getCatchupMessages).toHaveBeenCalledWith(
      'user-1',
      '2026-09-28T10:00:00.000Z',
    );
  });

  it('looks up the conversations it is asked to join, up to the cap', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const gateway = buildGateway({ prisma: { conversation: { findMany } } });
    const socket = fakeSocket({
      data: { userId: 'user-1' },
      rooms: new Set<string>(),
    });
    const ids = Array.from({ length: 1000 }, (_, i) => `conv-${i}`);
    await gateway.handleJoinRooms(socket, { conversationIds: ids });
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
