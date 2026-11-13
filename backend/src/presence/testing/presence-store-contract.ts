import {
  OFFLINE_GRACE_MS,
  SOCKET_TTL_MS,
  type PresenceStore,
} from '../presence-store';

/**
 * What every PresenceStore must do, at explicit times. Run against the
 * in-memory store always and against the Redis scripts when a disposable
 * Redis is available, so the two cannot drift apart.
 */
export function presenceStoreContract(
  makeStore: () => PresenceStore,
  newUserId: () => string,
): void {
  const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);
  const iso = (ms: number) => new Date(ms).toISOString();
  let store: PresenceStore;
  let user: string;

  beforeEach(() => {
    store = makeStore();
    user = newUserId();
  });

  const sockets = async (at: number) =>
    [...((await store.read([user], at))[0]?.socketIds ?? [])].sort();

  it('announces online once: first socket yes, a second device or a heartbeat no', async () => {
    await expect(store.online(user, 'a', T0)).resolves.toBe(true);
    await expect(store.online(user, 'b', T0 + 10)).resolves.toBe(false);
    await expect(store.online(user, 'a', T0 + 20)).resolves.toBe(false);
    expect(await sockets(T0 + 30)).toEqual(['a', 'b']);
    const [presence] = await store.read([user], T0 + 30);
    expect(presence).toMatchObject({
      status: 'online',
      lastSeen: iso(T0 + 20),
    });
  });

  it('a disconnect reports who is still live and when the last of them expires', async () => {
    await store.online(user, 'a', T0);
    await store.online(user, 'b', T0 + 5);
    await expect(store.offline(user, 'a', T0 + 10)).resolves.toEqual({
      live: ['b'],
      latest: T0 + 5 + SOCKET_TTL_MS,
    });
    await expect(store.offline(user, 'b', T0 + 20)).resolves.toEqual({
      live: [],
      latest: 0,
    });
    // Until the offline check runs, readers get what viewers were last told.
    const [during] = await store.read([user], T0 + 30);
    expect(during).toEqual({
      status: 'online',
      lastSeen: iso(T0 + 20),
      socketIds: [],
    });
    const checked = T0 + 20 + OFFLINE_GRACE_MS;
    await expect(store.confirmOffline(user, checked)).resolves.toBe(true);
    const [after] = await store.read([user], checked);
    expect(after).toEqual({
      status: 'offline',
      lastSeen: iso(T0 + 20),
      socketIds: [],
    });
  });

  it('an offline check that never runs stops holding the user online a second after the grace', async () => {
    await store.online(user, 'a', T0);
    await store.offline(user, 'a', T0 + 1);
    const limit = T0 + 1 + OFFLINE_GRACE_MS + 1000;
    expect((await store.read([user], limit - 1))[0]?.status).toBe('online');
    expect((await store.read([user], limit))[0]?.status).toBe('offline');
  });

  it('a disconnect for a user with no record is nothing', async () => {
    await expect(store.offline(user, 'a', T0)).resolves.toBeNull();
    await expect(store.read([user], T0)).resolves.toEqual([null]);
  });

  it('confirms offline once per real change, and never while a socket is live', async () => {
    await store.online(user, 'a', T0);
    await expect(store.confirmOffline(user, T0 + 1)).resolves.toBe(false);
    await store.offline(user, 'a', T0 + 2);
    await expect(store.confirmOffline(user, T0 + 3)).resolves.toBe(true);
    await expect(store.confirmOffline(user, T0 + 4)).resolves.toBe(false);
    // Back again: online is news, and so is the next offline.
    await expect(store.online(user, 'b', T0 + 5)).resolves.toBe(true);
    await store.offline(user, 'b', T0 + 6);
    await expect(store.confirmOffline(user, T0 + 7)).resolves.toBe(true);
  });

  it('a reconnect before offline was confirmed is not news', async () => {
    await store.online(user, 'a', T0);
    await store.offline(user, 'a', T0 + 1);
    await expect(store.online(user, 'b', T0 + 2)).resolves.toBe(false);
    await expect(store.confirmOffline(user, T0 + 3)).resolves.toBe(false);
  });

  it('a socket that stops beating stops counting, with no disconnect', async () => {
    await store.online(user, 'a', T0);
    expect(await sockets(T0 + SOCKET_TTL_MS - 1)).toEqual(['a']);
    const [late] = await store.read([user], T0 + SOCKET_TTL_MS);
    expect(late).toMatchObject({ status: 'offline', socketIds: [] });
    await expect(store.confirmOffline(user, T0 + SOCKET_TTL_MS)).resolves.toBe(
      true,
    );
  });

  it('a heartbeat keeps a socket live past its first expiry', async () => {
    await store.online(user, 'a', T0);
    await store.online(user, 'a', T0 + 25_000);
    expect(await sockets(T0 + SOCKET_TTL_MS + 1)).toEqual(['a']);
  });

  it('a new socket clears out ones that have expired', async () => {
    await store.online(user, 'dead', T0);
    await store.online(user, 'b', T0 + SOCKET_TTL_MS + 1);
    // Read at T0, when `dead` would still be live if it had been kept.
    expect(await sockets(T0)).toEqual(['b']);
  });

  it('confirms offline for a record that has gone entirely', async () => {
    await expect(store.confirmOffline(user, T0)).resolves.toBe(true);
    await expect(store.read([user], T0)).resolves.toEqual([null]);
  });

  it('reads many in order, null for anyone without a record', async () => {
    const other = newUserId();
    const nobody = newUserId();
    await store.online(user, 'a', T0);
    await store.online(other, 'x', T0);
    await store.offline(other, 'x', T0 + 1);
    const [one, two, three] = await store.read(
      [user, nobody, other],
      T0 + 1 + OFFLINE_GRACE_MS + 1000,
    );
    expect(one?.status).toBe('online');
    expect(two).toBeNull();
    expect(three?.status).toBe('offline');
    await expect(store.read([], T0)).resolves.toEqual([]);
  });

  it('remove leaves no record', async () => {
    await store.online(user, 'a', T0);
    await store.remove(user);
    await expect(store.read([user], T0)).resolves.toEqual([null]);
  });
}
