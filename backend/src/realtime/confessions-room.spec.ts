import { buildGateway, fakeSocket } from './testing/gateway.fixture';
import type { RealtimeGateway } from './realtime.gateway';

/**
 * The campus confessions room. It carries reaction totals for one campus's
 * confessions, so who may be in it is an authorization decision: the room is
 * named from the caller's ACTIVE affiliation, never from anything the client
 * sends, and a campus change takes the caller out of it at once.
 */
describe('RealtimeGateway — confessions room', () => {
  const getActiveCollegeId = jest.fn<Promise<string | null>, [string]>();
  let gateway: RealtimeGateway;

  const socket = (rooms: string[] = []) =>
    fakeSocket({
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      rooms: new Set(rooms),
      data: { userId: 'viewer' },
    });

  beforeEach(() => {
    getActiveCollegeId.mockReset();
    gateway = buildGateway({
      redis: { getClient: jest.fn() },
      campusAccess: { getActiveCollegeId },
    });
  });

  it('joins the room of the caller’s own campus', async () => {
    getActiveCollegeId.mockResolvedValue('college-a');
    const client = socket();
    await gateway.handleConfessionsJoin(client);
    expect(getActiveCollegeId).toHaveBeenCalledWith('viewer');
    expect(client.join).toHaveBeenCalledWith('confessions_college-a');
  });

  it('refuses without an active affiliation, and leaves an old campus’s room', async () => {
    getActiveCollegeId.mockResolvedValue(null);
    const client = socket(['viewer', 'confessions_college-old']);
    await gateway.handleConfessionsJoin(client);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.leave).toHaveBeenCalledWith('confessions_college-old');
    expect(client.leave).not.toHaveBeenCalledWith('viewer');
  });

  it('fails closed when the affiliation lookup throws, or is not wired', async () => {
    getActiveCollegeId.mockRejectedValue(new Error('db down'));
    const client = socket();
    await gateway.handleConfessionsJoin(client);
    expect(client.join).not.toHaveBeenCalled();

    const unwired = buildGateway({ redis: { getClient: jest.fn() } });
    const other = socket();
    await unwired.handleConfessionsJoin(other);
    expect(other.join).not.toHaveBeenCalled();
  });

  it('leaves every confessions room on request', () => {
    const client = socket(['viewer', 'confessions_college-a', 'post_p1']);
    gateway.handleConfessionsLeave(client);
    expect(client.leave).toHaveBeenCalledTimes(1);
    expect(client.leave).toHaveBeenCalledWith('confessions_college-a');
  });

  describe('events', () => {
    const roomEmit = jest.fn();
    const to = jest.fn((_room: string) => ({ emit: roomEmit }));
    const routed = (type: string, data: Record<string, unknown>) =>
      gateway['handleDomainEvent']({
        type,
        timestamp: new Date().toISOString(),
        data,
      });

    beforeEach(() => {
      roomEmit.mockReset();
      to.mockClear();
      (gateway as unknown as { server: unknown }).server = {
        to,
        sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
      };
    });

    it('sends reaction totals to that campus’s room only', () => {
      routed('confession.reactions', {
        collegeId: 'college-a',
        confessionId: 'c1',
        reactions: { love: 1, funny: 0, sad: 0, surprised: 0, relatable: 0 },
        reactionCount: 1,
      });
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith('confessions_college-a');
      expect(roomEmit).toHaveBeenCalledWith(
        'domainEvent',
        expect.objectContaining({ type: 'confession.reactions' }),
      );
    });

    it('takes a user whose campus changed out of the room on this instance', () => {
      const leave = jest.fn();
      const s1 = { rooms: new Set(['viewer', 'confessions_college-a']), leave };
      (gateway as unknown as { server: unknown }).server = {
        to,
        sockets: {
          adapter: { rooms: new Map([['viewer', new Set(['s1'])]]) },
          sockets: new Map([['s1', s1]]),
        },
      };
      routed('user:campus_changed', {
        userId: 'viewer',
        campusAffiliation: null,
      });
      expect(leave).toHaveBeenCalledWith('confessions_college-a');
    });
  });
});
