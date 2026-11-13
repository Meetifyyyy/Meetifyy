import type Redis from 'ioredis';

export interface UserPresence {
  lastSeen: string;
  status: 'online' | 'idle' | 'offline';
  socketIds: string[];
}

/**
 * How long a socket counts as live after it connected or last sent a
 * heartbeat. Clients beat every 25 s; 90 s is the TTL the presence record has
 * always had, so a socket is live exactly as long as it used to keep the
 * record alive.
 */
export const SOCKET_TTL_MS = 90_000;

/** A record nobody has written to for this long disappears. */
export const RECORD_TTL_MS = 90_000;

/**
 * How long a user with no live socket waits before viewers are told they went
 * offline. A reconnect inside it (a network change, a page reload) shows
 * nothing at all.
 */
export const OFFLINE_GRACE_MS = 2000;

/**
 * Reads inside the grace period answer what viewers were last told, so a list
 * loaded then agrees with the announcements (a reconnect inside it announces
 * nothing). The extra second covers the offline check's own latency; past it,
 * a check that never ran (its process stopped) no longer holds anyone online.
 */
const GRACE_READ_MS = OFFLINE_GRACE_MS + 1000;

/** Fields that are not socket ids start with `~`, which a Socket.IO id never contains. */
const SEEN = '~seen';
const SAID = '~said';

/**
 * One user's presence: which sockets are live and what viewers were last told.
 *
 * The record is a Redis hash, `presence:v2:<userId>`:
 *   <socketId> -> epoch ms until which that socket counts as live
 *   ~seen      -> ISO time of the last connect, heartbeat or disconnect
 *   ~said      -> 'online' | 'offline', the status last announced to viewers
 *
 * It replaces a JSON string that every connect and disconnect read, changed in
 * the server and wrote back whole (MSG-16). Two sockets of one user arriving
 * together could each write a list without the other, so one socket vanished,
 * and the user later showed offline while still connected. Liveness was also
 * decided by asking this process whether it still held each socket, which on
 * more than one replica dropped every socket held elsewhere. Now each change
 * is one atomic script, liveness is the socket's own heartbeat time, and
 * `~said` makes "announce online" and "announce offline" each happen once per
 * real change, whichever replica gets there first.
 */
export interface PresenceStore {
  /** Adds or refreshes a socket. True when viewers were not last told "online". */
  online(userId: string, socketId: string, nowMs: number): Promise<boolean>;
  /**
   * Removes a socket. The sockets still live afterwards and the latest of
   * their expiry times, or null when the user has no record at all.
   */
  offline(
    userId: string,
    socketId: string,
    nowMs: number,
  ): Promise<{ live: string[]; latest: number } | null>;
  /**
   * True when no socket is live and viewers were not yet told "offline", and
   * records that they now are: true at most once per real change.
   */
  confirmOffline(userId: string, nowMs: number): Promise<boolean>;
  read(userIds: string[], nowMs: number): Promise<Array<UserPresence | null>>;
  remove(userId: string): Promise<void>;
}

const isSocketField = (field: string) => !field.startsWith('~');

/** The presence a record describes, at `nowMs`. Null when there is no record. */
export function presenceFromRecord(
  record: Record<string, string>,
  nowMs: number,
): UserPresence | null {
  const fields = Object.keys(record);
  if (fields.length === 0) return null;
  const socketIds = fields.filter(
    (field) => isSocketField(field) && Number(record[field]) > nowMs,
  );
  const seen = record[SEEN];
  const inGrace =
    record[SAID] === 'online' &&
    seen !== undefined &&
    nowMs - Date.parse(seen) < GRACE_READ_MS;
  return {
    lastSeen: seen ?? new Date(nowMs).toISOString(),
    status: socketIds.length > 0 || inGrace ? 'online' : 'offline',
    socketIds,
  };
}

const presenceKey = (userId: string) => `presence:v2:${userId}`;
/** The JSON record this replaced; it expires on its own within 90 s of a deploy. */
const legacyPresenceKey = (userId: string) => `presence:${userId}`;

/** KEYS[1] record; ARGV socket id, now ms, socket live until ms, now ISO, record TTL ms. */
const ONLINE_SCRIPT = `
local now = tonumber(ARGV[2])
local h = redis.call('HGETALL', KEYS[1])
local said = false
for i = 1, #h, 2 do
  local f = h[i]
  if f == '${SAID}' then
    said = h[i + 1]
  elseif string.sub(f, 1, 1) ~= '~' and f ~= ARGV[1] then
    local exp = tonumber(h[i + 1])
    if exp == nil or exp <= now then redis.call('HDEL', KEYS[1], f) end
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3], '${SEEN}', ARGV[4], '${SAID}', 'online')
redis.call('PEXPIRE', KEYS[1], ARGV[5])
if said == 'online' then return 0 end
return 1
`;

/** KEYS[1] record; ARGV socket id, now ms, now ISO, record TTL ms. */
const OFFLINE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[1], '${SEEN}', ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
local now = tonumber(ARGV[2])
local h = redis.call('HGETALL', KEYS[1])
local out = { 0 }
for i = 1, #h, 2 do
  local f = h[i]
  if string.sub(f, 1, 1) ~= '~' then
    local exp = tonumber(h[i + 1])
    if exp ~= nil and exp > now then
      out[#out + 1] = f
      if exp > out[1] then out[1] = exp end
    end
  end
end
return out
`;

/**
 * KEYS[1] record; ARGV now ms. A record that has expired means nobody wrote
 * for 90 s, so no socket is live; it is announced and left absent.
 */
const CONFIRM_OFFLINE_SCRIPT = `
local now = tonumber(ARGV[1])
local h = redis.call('HGETALL', KEYS[1])
local said = false
for i = 1, #h, 2 do
  local f = h[i]
  if f == '${SAID}' then
    said = h[i + 1]
  elseif string.sub(f, 1, 1) ~= '~' then
    local exp = tonumber(h[i + 1])
    if exp ~= nil and exp > now then return 0 end
  end
end
if said == 'offline' then return 0 end
if #h > 0 then redis.call('HSET', KEYS[1], '${SAID}', 'offline') end
return 1
`;

export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: Redis) {}

  async online(
    userId: string,
    socketId: string,
    nowMs: number,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      ONLINE_SCRIPT,
      1,
      presenceKey(userId),
      socketId,
      String(nowMs),
      String(nowMs + SOCKET_TTL_MS),
      new Date(nowMs).toISOString(),
      String(RECORD_TTL_MS),
    );
    return result === 1;
  }

  async offline(
    userId: string,
    socketId: string,
    nowMs: number,
  ): Promise<{ live: string[]; latest: number } | null> {
    const result = await this.redis.eval(
      OFFLINE_SCRIPT,
      1,
      presenceKey(userId),
      socketId,
      String(nowMs),
      new Date(nowMs).toISOString(),
      String(RECORD_TTL_MS),
    );
    if (!Array.isArray(result)) return null;
    const [latest, ...live] = result as unknown[];
    return {
      latest: typeof latest === 'number' ? latest : 0,
      live: live.filter((id): id is string => typeof id === 'string'),
    };
  }

  async confirmOffline(userId: string, nowMs: number): Promise<boolean> {
    const result = await this.redis.eval(
      CONFIRM_OFFLINE_SCRIPT,
      1,
      presenceKey(userId),
      String(nowMs),
    );
    return result === 1;
  }

  async read(
    userIds: string[],
    nowMs: number,
  ): Promise<Array<UserPresence | null>> {
    if (userIds.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const userId of userIds) pipeline.hgetall(presenceKey(userId));
    const replies = (await pipeline.exec()) ?? [];
    return userIds.map((_, index) => {
      const [error, record] = replies[index] ?? [null, null];
      if (error || !record || typeof record !== 'object') return null;
      return presenceFromRecord(record as Record<string, string>, nowMs);
    });
  }

  async remove(userId: string): Promise<void> {
    await this.redis.del(presenceKey(userId), legacyPresenceKey(userId));
  }
}

/**
 * The same record in process memory, for running without Redis. Each method
 * finishes without awaiting, so on one process it is as atomic as the scripts.
 */
export class MemoryPresenceStore implements PresenceStore {
  private readonly records = new Map<string, Map<string, string>>();

  online(userId: string, socketId: string, nowMs: number): Promise<boolean> {
    const record = this.records.get(userId) ?? new Map<string, string>();
    const said = record.get(SAID);
    for (const [field, value] of record) {
      if (
        isSocketField(field) &&
        field !== socketId &&
        !(Number(value) > nowMs)
      )
        record.delete(field);
    }
    record.set(socketId, String(nowMs + SOCKET_TTL_MS));
    record.set(SEEN, new Date(nowMs).toISOString());
    record.set(SAID, 'online');
    this.records.set(userId, record);
    return Promise.resolve(said !== 'online');
  }

  offline(
    userId: string,
    socketId: string,
    nowMs: number,
  ): Promise<{ live: string[]; latest: number } | null> {
    const record = this.records.get(userId);
    if (!record) return Promise.resolve(null);
    record.delete(socketId);
    record.set(SEEN, new Date(nowMs).toISOString());
    const live: string[] = [];
    let latest = 0;
    for (const [field, value] of record) {
      const expires = Number(value);
      if (isSocketField(field) && expires > nowMs) {
        live.push(field);
        latest = Math.max(latest, expires);
      }
    }
    return Promise.resolve({ live, latest });
  }

  confirmOffline(userId: string, nowMs: number): Promise<boolean> {
    const record = this.records.get(userId);
    if (!record) return Promise.resolve(true);
    for (const [field, value] of record) {
      if (isSocketField(field) && Number(value) > nowMs)
        return Promise.resolve(false);
    }
    if (record.get(SAID) === 'offline') return Promise.resolve(false);
    record.set(SAID, 'offline');
    return Promise.resolve(true);
  }

  read(userIds: string[], nowMs: number): Promise<Array<UserPresence | null>> {
    return Promise.resolve(
      userIds.map((userId) => {
        const record = this.records.get(userId);
        return record
          ? presenceFromRecord(Object.fromEntries(record), nowMs)
          : null;
      }),
    );
  }

  remove(userId: string): Promise<void> {
    this.records.delete(userId);
    return Promise.resolve();
  }
}
