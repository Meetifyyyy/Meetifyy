import type Redis from 'ioredis';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { stub } from '../common/testing/stub';
import { isRecord } from '../common/utils/type-guards.util';

/**
 * Every API replica runs the activity lifecycle sweep every minute. These
 * specs run the same tick on two "replicas" at once against one shared
 * database and assert each side effect happens once.
 *
 * The database is modelled as an in-memory store whose `UPDATE ... RETURNING`
 * flips the rows and returns them in one synchronous step, which is what
 * Postgres guarantees for a single statement: a concurrent second statement
 * waits for the row lock, sees the new state, and matches nothing. Which SQL
 * text does that in a real database needs a Postgres run; what is pinned here
 * is that the service acts only on the rows its own statement returned.
 */

type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED';

interface InvitationRow {
  id: string;
  activityId: string;
  inviteeId: string;
  status: InvitationStatus;
}

interface ActivityRow {
  id: string;
  status: 'OPEN' | 'ENDED';
  startDate: Date | null;
  endDate: Date | null;
  deletedAt: Date | null;
}

const HOUR = 60 * 60 * 1000;

class FakeDatabase {
  invitations: InvitationRow[] = [];
  activities: ActivityRow[] = [];

  /** The tagged-template entry point `prisma.$queryRaw` is called through. */
  readonly queryRaw = jest.fn(
    async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown[]> => {
      // Both replicas are in flight before either statement lands.
      await Promise.resolve();
      const sql = strings.join('?');
      const now = Date.now();

      if (/^\s*UPDATE "ActivityInvitation" AS i/.test(sql)) {
        return this.claimInvitations((row) => {
          const act = this.activities.find((a) => a.id === row.activityId);
          return (
            !!act &&
            act.deletedAt === null &&
            act.startDate !== null &&
            act.startDate.getTime() <= now
          );
        });
      }

      if (/^\s*UPDATE "CrewActivity"/.test(sql)) {
        const claimed = this.activities.filter(
          (a) =>
            a.status === 'OPEN' &&
            a.deletedAt === null &&
            ((a.endDate !== null && a.endDate.getTime() <= now) ||
              (a.endDate === null &&
                a.startDate !== null &&
                a.startDate.getTime() <= now - 3 * HOUR)),
        );
        for (const a of claimed) a.status = 'ENDED';
        return claimed.map((a) => ({ id: a.id }));
      }

      if (/^\s*UPDATE "ActivityInvitation"\s+SET/.test(sql)) {
        // `Prisma.join(ids)` arrives as one fragment carrying the ids.
        const ids = values.flatMap((v) =>
          isRecord(v) && Array.isArray(v.values) ? (v.values as unknown[]) : [],
        );
        return this.claimInvitations((row) => ids.includes(row.activityId));
      }

      throw new Error(`unexpected SQL: ${sql}`);
    },
  );

  private claimInvitations(
    matches: (row: InvitationRow) => boolean,
  ): Array<{ activityId: string; inviteeId: string }> {
    const claimed = this.invitations.filter(
      (row) => row.status === 'PENDING' && matches(row),
    );
    for (const row of claimed) row.status = 'EXPIRED';
    return claimed.map((row) => ({
      activityId: row.activityId,
      inviteeId: row.inviteeId,
    }));
  }
}

interface SettleArgs {
  entityId: string;
  status: string;
  recipientIds: string[];
}

/**
 * One API process: its own service and its own outgoing side effects.
 * `startedRows` is what this process's start-time query returns.
 */
function buildReplica(
  db: FakeDatabase,
  redisClient: Redis | null = null,
  startedRows: Array<{ id: string; startDate: Date }> = [],
) {
  const settle = jest
    .fn<Promise<void>, [SettleArgs]>()
    .mockResolvedValue(undefined);
  const emit = jest
    .fn<Promise<void>, [string, unknown, string[]?]>()
    .mockResolvedValue(undefined);
  const service = new ActivitiesService(
    stub<PrismaService>({
      $queryRaw: db.queryRaw,
      crewActivity: { findMany: jest.fn().mockResolvedValue(startedRows) },
    }),
    stub<NotificationsService>({ updateNotificationLifecycleStatus: settle }),
    stub<NotificationFactory>(),
    stub<BlocksService>(),
    stub<DomainEventService>({ emit }),
    stub<ActivityAuthorizationService>(),
    stub<RedisService>({ getClient: () => redisClient }),
  );
  return { service, settle, emit };
}

const past = (ms: number) => new Date(Date.now() - ms);

describe('Activity lifecycle sweep on two replicas', () => {
  let db: FakeDatabase;

  beforeEach(() => {
    db = new FakeDatabase();
  });

  describe('expireStartedInvitations', () => {
    beforeEach(() => {
      db.activities = [
        {
          id: 'started',
          status: 'OPEN',
          startDate: past(1000),
          endDate: null,
          deletedAt: null,
        },
        {
          id: 'later',
          status: 'OPEN',
          startDate: new Date(Date.now() + HOUR),
          endDate: null,
          deletedAt: null,
        },
      ];
      db.invitations = [
        { id: 'i1', activityId: 'started', inviteeId: 'u1', status: 'PENDING' },
        { id: 'i2', activityId: 'started', inviteeId: 'u2', status: 'PENDING' },
        {
          id: 'i3',
          activityId: 'started',
          inviteeId: 'u3',
          status: 'ACCEPTED',
        },
        { id: 'i4', activityId: 'later', inviteeId: 'u4', status: 'PENDING' },
      ];
    });

    it('notifies each invitee once however many replicas run the tick', async () => {
      const a = buildReplica(db);
      const b = buildReplica(db);

      await Promise.all([
        a.service.expireStartedInvitations(),
        b.service.expireStartedInvitations(),
      ]);

      const settled = [...a.settle.mock.calls, ...b.settle.mock.calls];
      expect(settled).toHaveLength(1);
      expect(settled[0][0]).toMatchObject({
        entityId: 'started',
        status: 'EXPIRED',
        recipientIds: ['u1', 'u2'],
      });

      const events = [...a.emit.mock.calls, ...b.emit.mock.calls];
      expect(events).toEqual([
        [
          'invitation:updated',
          { activityId: 'started', status: 'EXPIRED' },
          ['u1', 'u2'],
        ],
      ]);
    });

    it('leaves answered invitations and not-yet-started activities alone', async () => {
      const a = buildReplica(db);

      await a.service.expireStartedInvitations();

      expect(db.invitations.map((i) => [i.id, i.status])).toEqual([
        ['i1', 'EXPIRED'],
        ['i2', 'EXPIRED'],
        ['i3', 'ACCEPTED'],
        ['i4', 'PENDING'],
      ]);
    });

    it('does nothing when the claim returns no rows', async () => {
      db.invitations = [];
      const a = buildReplica(db);

      await a.service.expireStartedInvitations();

      expect(a.settle).not.toHaveBeenCalled();
      expect(a.emit).not.toHaveBeenCalled();
    });
  });

  describe('autoExpireActivities', () => {
    beforeEach(() => {
      db.activities = [
        {
          id: 'ended',
          status: 'OPEN',
          startDate: past(5 * HOUR),
          endDate: past(HOUR),
          deletedAt: null,
        },
        {
          id: 'no-end-old',
          status: 'OPEN',
          startDate: past(4 * HOUR),
          endDate: null,
          deletedAt: null,
        },
        {
          id: 'running',
          status: 'OPEN',
          startDate: past(HOUR),
          endDate: null,
          deletedAt: null,
        },
      ];
      db.invitations = [
        { id: 'i1', activityId: 'ended', inviteeId: 'u1', status: 'PENDING' },
        {
          id: 'i2',
          activityId: 'no-end-old',
          inviteeId: 'u2',
          status: 'PENDING',
        },
        { id: 'i3', activityId: 'running', inviteeId: 'u3', status: 'PENDING' },
      ];
    });

    it('ends each activity and settles its invitations once across replicas', async () => {
      const a = buildReplica(db);
      const b = buildReplica(db);

      await Promise.all([
        a.service.autoExpireActivities(),
        b.service.autoExpireActivities(),
      ]);

      const settled = [...a.settle.mock.calls, ...b.settle.mock.calls];
      expect(settled).toHaveLength(2);
      expect(settled).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              entityId: 'ended',
              recipientIds: ['u1'],
            }),
          ],
          [
            expect.objectContaining({
              entityId: 'no-end-old',
              recipientIds: ['u2'],
            }),
          ],
        ]),
      );

      const ended = [...a.emit.mock.calls, ...b.emit.mock.calls];
      expect(ended).toHaveLength(2);
      expect(ended).toEqual(
        expect.arrayContaining([
          ['activity.updated', { id: 'ended', status: 'ENDED' }],
          ['activity.updated', { id: 'no-end-old', status: 'ENDED' }],
        ]),
      );
    });

    it('leaves a still-running activity and its invitations untouched', async () => {
      await buildReplica(db).service.autoExpireActivities();

      expect(db.activities.find((x) => x.id === 'running')?.status).toBe(
        'OPEN',
      );
      expect(db.invitations.find((x) => x.id === 'i3')?.status).toBe('PENDING');
    });

    it('does not touch invitations when it claimed no activity', async () => {
      db.activities = db.activities.filter((x) => x.id === 'running');
      const a = buildReplica(db);

      await a.service.autoExpireActivities();

      expect(db.queryRaw).toHaveBeenCalledTimes(1);
      expect(a.emit).not.toHaveBeenCalled();
    });
  });

  describe('announceStartedActivities', () => {
    /** SET key value EX ttl NX against one shared keyspace. */
    function sharedRedis(failWith?: Error) {
      const keys = new Set<string>();
      const set = jest.fn(
        (key: string, _value: string, _ex: 'EX', _ttl: number, _nx: 'NX') => {
          if (failWith) return Promise.reject(failWith);
          if (keys.has(key)) return Promise.resolve(null);
          keys.add(key);
          return Promise.resolve('OK' as const);
        },
      );
      return { client: stub<Redis>({ set }), keys };
    }

    function replicaSeeing(
      redis: Redis | null,
      rows: Array<{ id: string; startDate: Date }>,
    ) {
      return buildReplica(db, redis, rows);
    }

    /** The first tick after boot only records its window; the second sweeps. */
    async function tick(replica: ReturnType<typeof buildReplica>) {
      await replica.service.announceStartedActivities();
      await replica.service.announceStartedActivities();
    }

    const started = {
      id: 'act-1',
      startDate: new Date('2026-11-13T10:00:00Z'),
    };

    it('announces a start once when both replicas find the activity', async () => {
      const { client } = sharedRedis();
      const a = replicaSeeing(client, [started]);
      const b = replicaSeeing(client, [started]);

      await Promise.all([tick(a), tick(b)]);

      const announced = [...a.emit.mock.calls, ...b.emit.mock.calls];
      expect(announced).toHaveLength(1);
      expect(announced[0][0]).toBe('activity.started');
    });

    it('announces again when the activity is rescheduled to a new start', async () => {
      const { client } = sharedRedis();
      const a = replicaSeeing(client, [started]);
      const b = replicaSeeing(client, [
        { ...started, startDate: new Date('2026-11-13T12:00:00Z') },
      ]);

      await Promise.all([tick(a), tick(b)]);

      expect(a.emit).toHaveBeenCalledTimes(1);
      expect(b.emit).toHaveBeenCalledTimes(1);
    });

    it('still announces when Redis cannot be reached', async () => {
      const { client } = sharedRedis(new Error('connection reset'));
      const a = replicaSeeing(client, [started]);

      await tick(a);

      expect(a.emit).toHaveBeenCalledTimes(1);
    });

    it('announces without any Redis (a single process)', async () => {
      const a = replicaSeeing(null, [started]);

      await tick(a);

      expect(a.emit).toHaveBeenCalledTimes(1);
    });
  });
});
