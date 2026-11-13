import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { SOCKET_TTL_MS } from './presence-store';
import { PresenceService } from './presence.service';

/**
 * When viewers are told someone came online or went offline (MSG-16), on the
 * in-memory store with fake timers. presence.redis.spec.ts runs the races
 * against a real Redis with two services standing in for two replicas.
 */
describe('PresenceService announcements', () => {
  const USER = 'user-1';
  let service: PresenceService;
  let said: Array<[string, string]>;
  let local: Set<string>;

  beforeEach(() => {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 13, 12, 0, 0) });
    service = new PresenceService(
      stub<RedisService>({ getClient: () => null }),
      stub<PrismaService>({
        user: { update: jest.fn(() => Promise.resolve({})) },
      }),
    );
    said = [];
    service.onStatusChange((userId, status) => said.push([userId, status]));
    local = new Set();
    service.registerSocketValidator((id) => local.has(id));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const connect = async (socketId: string, isLocal = true) => {
    if (isLocal) local.add(socketId);
    await service.setOnline(USER, socketId);
  };
  const disconnect = async (socketId: string) => {
    local.delete(socketId);
    await service.setOffline(USER, socketId);
  };

  it('says online once for the first socket, not for a second device or a heartbeat', async () => {
    await connect('a');
    await connect('b');
    await service.setOnline(USER, 'a');
    expect(said).toEqual([[USER, 'online']]);
  });

  it('two sockets connecting together are both kept, and announced once', async () => {
    await Promise.all([connect('a'), connect('b')]);
    expect(said).toEqual([[USER, 'online']]);
    const presence = await service.getPresence(USER);
    expect([...(presence?.socketIds ?? [])].sort()).toEqual(['a', 'b']);
  });

  it('says offline only after the grace period, once', async () => {
    await connect('a');
    await disconnect('a');
    await jest.advanceTimersByTimeAsync(1999);
    expect(said).toEqual([[USER, 'online']]);
    await jest.advanceTimersByTimeAsync(1);
    expect(said).toEqual([
      [USER, 'online'],
      [USER, 'offline'],
    ]);
    await jest.advanceTimersByTimeAsync(5 * SOCKET_TTL_MS);
    expect(said).toHaveLength(2);
  });

  it('a reconnect inside the grace period shows nothing at all', async () => {
    await connect('a');
    await disconnect('a');
    await jest.advanceTimersByTimeAsync(1500);
    await connect('b');
    await jest.advanceTimersByTimeAsync(5 * SOCKET_TTL_MS);
    expect(said).toEqual([[USER, 'online']]);
  });

  it('closing one of two local sockets says nothing, and schedules nothing', async () => {
    await connect('a');
    await connect('b');
    await disconnect('a');
    await jest.advanceTimersByTimeAsync(5 * SOCKET_TTL_MS);
    expect(said).toEqual([[USER, 'online']]);
  });

  it('a socket left behind by a stopped process cannot keep the user online', async () => {
    await connect('orphan', false); // never refreshed, never disconnected
    await jest.advanceTimersByTimeAsync(30_000);
    await connect('b');
    await disconnect('b');
    // `orphan` still counts until 90 s after it connected.
    await jest.advanceTimersByTimeAsync(SOCKET_TTL_MS - 30_000);
    expect(said).toEqual([[USER, 'online']]);
    await jest.advanceTimersByTimeAsync(1000);
    expect(said).toEqual([
      [USER, 'online'],
      [USER, 'offline'],
    ]);
  });

  it('a socket still alive on another replica keeps the user online through the re-check', async () => {
    await connect('elsewhere', false);
    await connect('b');
    await disconnect('b');
    // The other replica's socket keeps beating, through ITS service: straight
    // into the shared record, leaving this service's re-check in place.
    for (let t = 0; t < 8; t += 1) {
      await jest.advanceTimersByTimeAsync(25_000);
      await service['store'].online(USER, 'elsewhere', Date.now());
    }
    expect(said).toEqual([[USER, 'online']]);
    await expect(service.getPresence(USER)).resolves.toMatchObject({
      status: 'online',
      socketIds: ['elsewhere'],
    });
  });

  it('reads the user as viewers were told: online through the grace, offline once announced', async () => {
    await connect('a');
    await disconnect('a');
    await expect(service.getPresence(USER)).resolves.toMatchObject({
      status: 'online',
      socketIds: [],
    });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(service.getPresence(USER)).resolves.toMatchObject({
      status: 'offline',
      socketIds: [],
    });
    const many = await service.getPresenceMany([USER, 'nobody']);
    expect([...many.keys()]).toEqual([USER]);
  });

  it('removing a deleted user cancels a pending offline announcement', async () => {
    await connect('a');
    await disconnect('a');
    await service.removePresence(USER);
    await jest.advanceTimersByTimeAsync(5000);
    expect(said).toEqual([[USER, 'online']]);
    await expect(service.getPresence(USER)).resolves.toBeNull();
  });
});
