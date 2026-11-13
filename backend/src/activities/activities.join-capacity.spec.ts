import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ActivitiesService } from './activities.service';
import { ActivityAuthorizationService } from './activity-authorization.service';
import { ActivityDiscussionService } from './discussion/activity-discussion.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { BlocksService } from '../users/blocks.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../redis/redis.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { isActivityLock, type RawQuery } from './testing/join-transaction';

/**
 * The last seat of a capped activity must go to exactly one of two concurrent
 * joins.
 *
 * Postgres is not available to unit tests (PGlite serves one connection, so it
 * cannot interleave two transactions), so this models the one behaviour the fix
 * relies on: under READ COMMITTED each statement takes its snapshot when it
 * STARTS, and a `FOR NO KEY UPDATE` row lock makes a second transaction wait
 * until the first commits. The fake therefore snapshots the member count at the
 * start of the insert statement, lets the event loop turn before writing (the
 * window in which the real race happens), and serialises lock holders per
 * activity. What it proves is that the service puts the lock BEFORE the
 * counting insert in one transaction; whether Postgres honours the lock is
 * Postgres's contract. True concurrency needs a real server with two
 * connections.
 */
describe('joinActivity — last seat under concurrent joins', () => {
  const ACTIVITY = 'act-1';
  const HOST = 'host-1';
  const COLLEGE = 'college-gla';

  /** Minimal Postgres: a member table, per-row locks and per-statement snapshots. */
  class FakeDb {
    members = new Set<string>([HOST]);
    statements: Array<{ tx: number; sql: string; values: unknown[] }> = [];
    private txCounter = 0;
    private lockTail = new Map<string, Promise<void>>();

    constructor(private readonly maxMembers: number) {}

    /** Runs `fn` as one transaction; locks taken inside are released at the end. */
    transaction = async <T>(
      fn: (tx: { $queryRaw: RawQuery }) => Promise<T>,
    ): Promise<T> => {
      const txId = ++this.txCounter;
      const releases: Array<() => void> = [];
      const tx = {
        $queryRaw: async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ): Promise<unknown> => {
          this.statements.push({ tx: txId, sql: strings.join('?'), values });
          if (isActivityLock(strings)) {
            releases.push(await this.lock(String(values[0])));
            return [{ id: values[0] }];
          }
          return this.insertMember(values);
        },
      };
      try {
        return await fn(tx);
      } finally {
        for (const release of releases) release();
      }
    };

    /** Waits behind every earlier holder of this row's lock. */
    private async lock(row: string): Promise<() => void> {
      const previous = this.lockTail.get(row) ?? Promise.resolve();
      let release!: () => void;
      this.lockTail.set(
        row,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      await previous;
      return release;
    }

    /** The capacity CTE: count at statement start, write one turn later. */
    private async insertMember(values: unknown[]): Promise<unknown> {
      const activityId = String(values[0]);
      const userId = String(values.find((v) => v !== activityId));
      const countAtStart = this.members.size;
      await new Promise((resolve) => setImmediate(resolve));
      if (this.members.has(userId)) return [{ inserted: false }];
      if (countAtStart >= this.maxMembers) return [];
      this.members.add(userId);
      return [{ inserted: true }];
    }
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const build = async (maxMembers: number) => {
    const db = new FakeDb(maxMembers);
    const activityRow = {
      id: ACTIVITY,
      creatorId: HOST,
      collegeId: COLLEGE,
      visibility: 'PUBLIC',
      status: 'OPEN',
      deletedAt: null,
      startDate: new Date(Date.now() + 86_400_000),
      title: 'Sunset badminton',
      coverImage: null,
      coverColor: null,
      maxMembers,
      participationType: 'OPEN',
      hostCollege: null,
      invitations: [],
      _count: { members: 1 },
    };
    const prisma = {
      crewActivity: {
        findUnique: jest.fn(() => Promise.resolve(activityRow)),
      },
      crewActivityMember: {
        findUnique: jest.fn(() => Promise.resolve(null)),
      },
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            collegeId: COLLEGE,
            username: where.id,
            displayName: where.id,
            avatar: null,
          }),
        ),
      },
      activityInvitation: { updateMany: jest.fn() },
      $transaction: db.transaction,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ActivityDiscussionService,
        ActivityAuthorizationService,
        NotificationFactory,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn(() => Promise.resolve({})) },
        },
        {
          provide: BlocksService,
          useValue: {
            getExcludedUserIds: jest.fn(() => Promise.resolve([])),
            isBlocked: jest.fn(() => Promise.resolve(false)),
          },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        { provide: RedisService, useValue: { getClient: () => null } },
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();
    return { db, service: module.get(ActivitiesService) };
  };

  it('gives the last seat to exactly one of two concurrent joins', async () => {
    const { db, service } = await build(2); // host + one free seat

    const results = await Promise.allSettled([
      service.joinActivity(ACTIVITY, 'user-a'),
      service.joinActivity(ACTIVITY, 'user-b'),
    ]);
    await flush();

    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // The existing "full" answer, unchanged.
    expect(losers[0].reason).toBeInstanceOf(ForbiddenException);
    expect((losers[0].reason as ForbiddenException).message).toBe(
      'Activity is full',
    );
    expect(db.members.size).toBe(2);
  });

  it('never exceeds maxMembers however many joins race for the seats', async () => {
    const { db, service } = await build(4); // host + three seats

    const results = await Promise.allSettled(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((u) =>
        service.joinActivity(ACTIVITY, `user-${u}`),
      ),
    );
    await flush();

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    expect(db.members.size).toBe(4);
  });

  it('locks the activity row before counting, in the same transaction', async () => {
    const { db, service } = await build(5);

    await service.joinActivity(ACTIVITY, 'user-a');
    await flush();

    expect(db.statements).toHaveLength(2);
    const [lock, insert] = db.statements;
    expect(lock.tx).toBe(insert.tx);
    expect(lock.sql).toContain('FROM "CrewActivity"');
    expect(lock.sql).toContain('FOR NO KEY UPDATE');
    expect(lock.sql).toContain('"deletedAt" IS NULL');
    expect(lock.values).toEqual([ACTIVITY]);
    expect(insert.sql).toContain('INSERT INTO "CrewActivityMember"');
    expect(insert.sql).toContain('ON CONFLICT');
  });

  it('is idempotent: a repeat join by a member does not take a second seat', async () => {
    const { db, service } = await build(2);

    await service.joinActivity(ACTIVITY, 'user-a');
    await expect(service.joinActivity(ACTIVITY, 'user-a')).resolves.toEqual({
      success: true,
    });
    await flush();

    expect(db.members.size).toBe(2);
  });

  it('control: the same fake does overbook when the lock statement is left out', async () => {
    // Replays the service's own insert, without its lock, from two
    // transactions. If this ever stopped overbooking, the tests above would no
    // longer be able to tell a missing lock from a present one.
    const { db, service } = await build(2);
    await service.joinActivity(ACTIVITY, 'user-seed');
    await flush();
    const insert = db.statements.find((s) => s.sql.includes('INSERT INTO'));
    expect(insert).toBeDefined();
    if (!insert) return;

    const fresh = new FakeDb(2);
    const replay = (user: string) =>
      fresh.transaction((tx) => {
        const strings = Object.assign([...insert.sql.split('?')], {
          raw: insert.sql.split('?'),
        }) as unknown as TemplateStringsArray;
        return tx.$queryRaw(
          strings,
          ACTIVITY,
          ACTIVITY,
          user,
          ACTIVITY,
          user,
          ACTIVITY,
        );
      });
    await Promise.all([replay('user-a'), replay('user-b')]);

    expect(fresh.members.size).toBe(3);
  });
});
