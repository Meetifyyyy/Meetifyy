import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { detach } from '../common/utils/detach.util';
import { errorMessage } from '../common/utils/error.util';
import {
  MemoryPresenceStore,
  OFFLINE_GRACE_MS,
  RedisPresenceStore,
  type PresenceStore,
  type UserPresence,
} from './presence-store';

export type { UserPresence } from './presence-store';

/** Margin past the last socket's expiry before re-checking (see setOffline). */
const RECHECK_MARGIN_MS = 1000;

@Injectable()
export class PresenceService {
  private readonly store: PresenceStore;
  private readonly logger = new Logger('PRESENCE');
  private socketValidator: ((socketId: string) => boolean) | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {
    const redis = this.redisService.getClient();
    if (redis) {
      this.store = new RedisPresenceStore(redis);
      this.logger.log('Redis connected for Presence Service');
    } else {
      this.store = new MemoryPresenceStore();
      this.logger.warn(
        'Redis not configured. Presence features will be mocked in-memory.',
      );
    }
  }

  private statusChangeListeners: Array<
    (userId: string, status: 'online' | 'offline', lastSeen: string) => void
  > = [];

  /**
   * Tells the service which sockets THIS process holds. It is used only to
   * decide whether a disconnect needs a later re-check (see setOffline), never
   * to judge another socket dead: on more than one replica that dropped every
   * socket held elsewhere.
   */
  registerSocketValidator(validator: (socketId: string) => boolean) {
    this.socketValidator = validator;
  }

  onStatusChange(
    listener: (
      userId: string,
      status: 'online' | 'offline',
      lastSeen: string,
    ) => void,
  ) {
    this.statusChangeListeners.push(listener);
  }

  private notifyStatusChange(
    userId: string,
    status: 'online' | 'offline',
    lastSeen: string,
  ) {
    this.statusChangeListeners.forEach((listener) => {
      try {
        listener(userId, status, lastSeen);
      } catch (err) {
        this.logger.error(`Error in status change listener for ${userId}`, err);
      }
    });
  }

  private offlineChecks = new Map<string, NodeJS.Timeout>();

  /**
   * How long a `lastSeenAt` write is suppressed for after one succeeds.
   *
   * Presence itself lives only in Redis with a 90 second TTL, which answers
   * "who is online right now" and nothing else. Every question with a longer
   * horizon - active today, weekly actives, dormant accounts, the deletion
   * sweep - needs a durable timestamp, and there was none: `lastSeenAt` was
   * declared on the model and set to null by the purge worker, and NOTHING
   * ever wrote it. The admin dashboard's "Active Today" counted rows where it
   * was >= midnight, so it was structurally pinned to zero.
   *
   * Writing it on every connect would be a database write per socket, and
   * mobile clients reconnect constantly on network changes. Fifteen minutes is
   * far finer than any consumer needs (the coarsest bucket anyone asks for is
   * a day) and bounds the cost at four writes per active user per hour.
   */
  private static readonly LAST_SEEN_THROTTLE_SECONDS = 15 * 60;

  /**
   * Records that this user was here, at most once per throttle window.
   *
   * The throttle is a Redis key with `NX`, so the check and the claim are one
   * atomic operation: several sockets reconnecting together produce one write,
   * not one each. Best-effort throughout - a failure here must never stop
   * someone coming online, so it is logged at debug and swallowed.
   */
  private async touchLastSeen(userId: string): Promise<void> {
    if (!userId) return;
    try {
      const redis = this.redisService.getClient();
      if (redis) {
        const claimed = await redis.set(
          `lastseen:throttle:${userId}`,
          '1',
          'EX',
          PresenceService.LAST_SEEN_THROTTLE_SECONDS,
          'NX',
        );
        // Someone already claimed this window.
        if (claimed !== 'OK') return;
      }
      // `lastSeenAt` alone, as a HOT update (migration 44 dropped its index).
      // Not `user.update`: that also bumped `updatedAt`, which is part of the
      // share-card cache key, so fifteen minutes online retired the author's
      // cards for re-rendering. And it read the whole row back for nothing.
      await this.prisma.$executeRaw`
        UPDATE "User" SET "lastSeenAt" = ${new Date()} WHERE "id" = ${userId}`;
    } catch (error) {
      this.logger.debug(
        `lastSeenAt not recorded for ${userId}: ${(error as Error).message}`,
      );
    }
  }

  /** On connect and on every heartbeat. */
  async setOnline(userId: string, socketId: string): Promise<void> {
    // Durable "was here" stamp, throttled. Deliberately not awaited: presence
    // is a realtime path and must not wait on a database write that is only
    // needed by reporting.
    void this.touchLastSeen(userId);

    // The user is here, so a pending offline announcement is moot. One left on
    // another replica finds this socket live and stays silent.
    this.cancelOfflineCheck(userId);
    try {
      const now = Date.now();
      // Announced only when viewers were last told otherwise: a second device,
      // a heartbeat, or a reconnect inside the grace period says nothing.
      if (await this.store.online(userId, socketId, now)) {
        this.logger.log(`Online user=${userId}`);
        this.notifyStatusChange(userId, 'online', new Date(now).toISOString());
      }
    } catch (err) {
      this.logger.error(`Failed to set online presence for ${userId}`, err);
    }
  }

  async setOffline(userId: string, socketId: string): Promise<void> {
    try {
      const now = Date.now();
      const after = await this.store.offline(userId, socketId, now);
      if (!after) return;
      if (after.live.length === 0) {
        this.scheduleOfflineCheck(userId, OFFLINE_GRACE_MS);
        return;
      }
      // Other sockets still count as live. One this process holds reports its
      // own disconnect. Any other belongs to another replica, or was left
      // behind by a process that stopped without saying goodbye; the second
      // kind is never refreshed, so once every one of them would have expired
      // it is checked again, or the user would stay online to viewers forever.
      const elsewhere = after.live.some((id) => !this.socketValidator?.(id));
      if (elsewhere) {
        this.scheduleOfflineCheck(
          userId,
          Math.max(OFFLINE_GRACE_MS, after.latest - now + RECHECK_MARGIN_MS),
        );
      }
    } catch (err) {
      this.logger.error(`Failed to set offline presence for ${userId}`, err);
    }
  }

  private cancelOfflineCheck(userId: string): void {
    const timer = this.offlineChecks.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.offlineChecks.delete(userId);
    }
  }

  private scheduleOfflineCheck(userId: string, delayMs: number): void {
    this.cancelOfflineCheck(userId);
    const timer = setTimeout(
      () =>
        detach('presence offline check', async () => {
          this.offlineChecks.delete(userId);
          const now = Date.now();
          // True once per real change, on whichever replica asks first.
          if (await this.store.confirmOffline(userId, now)) {
            this.logger.log(`Offline user=${userId}`);
            this.notifyStatusChange(
              userId,
              'offline',
              new Date(now).toISOString(),
            );
          }
        }),
      delayMs,
    );
    timer.unref?.();
    this.offlineChecks.set(userId, timer);
  }

  async getPresence(userId: string): Promise<UserPresence | null> {
    try {
      const [presence] = await this.store.read([userId], Date.now());
      return presence ?? null;
    } catch (err) {
      this.logger.error(`Failed to get presence for ${userId}`, err);
      return null;
    }
  }

  /** One round trip for the whole list. */
  async getPresenceMany(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();
    if (!userIds || userIds.length === 0) return result;
    try {
      const presences = await this.store.read(userIds, Date.now());
      userIds.forEach((userId, index) => {
        const presence = presences[index];
        if (presence) result.set(userId, presence);
      });
    } catch (err) {
      this.logger.error(`Failed to get batch presence`, err);
    }
    return result;
  }

  /**
   * Fully removes a user's presence entry — called on account deletion so the
   * user no longer appears online in any presence query after deletion.
   * Also cancels any pending offline check.
   */
  async removePresence(userId: string): Promise<void> {
    this.cancelOfflineCheck(userId);
    try {
      await this.store.remove(userId);
      this.logger.log(`Removed presence for deleted user=${userId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to remove presence for user=${userId}: ${errorMessage(err)}`,
      );
    }
  }
}
