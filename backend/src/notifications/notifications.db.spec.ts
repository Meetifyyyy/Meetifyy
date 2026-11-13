import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { stub } from '../common/testing/stub';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { BlocksService } from '../users/blocks.service';
import type { CreateNotificationDto } from './notification.factory';
import { NotificationsService } from './notifications.service';

/**
 * Notifications against a real Postgres and a real Redis (E-5): the bell
 * count moves only when a row really changes state, so it ends every scenario
 * equal to a fresh count of the table (FEAT-12); blocks hide what the other
 * person sent and recount the bell (FEAT-25); actor-less notifications are one
 * per (recipient, entity, type) even when created at once (FEAT-27); follow
 * rows say whether the recipient follows back (FEP-11); an invite announces
 * itself once.
 *
 * Needs a disposable database with every migration applied, named in BOTH
 * `DATABASE_URL` and `NOTIFICATIONS_TEST_DATABASE_URL` on localhost, and a
 * disposable Redis on localhost in `NOTIFICATIONS_TEST_REDIS_URL`. Skipped
 * otherwise, so it can never run against a shared one.
 */
const DB_URL = process.env.NOTIFICATIONS_TEST_DATABASE_URL ?? '';
const REDIS_URL = process.env.NOTIFICATIONS_TEST_REDIS_URL ?? '';
const runnable =
  DB_URL !== '' &&
  process.env.DATABASE_URL === DB_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(DB_URL) &&
  /^redis:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(REDIS_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('notifications (database + Redis)', () => {
  let prisma: PrismaService;
  let redis: Redis;
  let service: NotificationsService;
  let events: EventEmitter2;
  const blocked = new Map<string, string[]>();
  const emitted: Array<{ type: string; data: unknown; targets: string[] }> = [];

  const users = async (n: number): Promise<string[]> => {
    const ids = Array.from({ length: n }, () => randomUUID());
    await prisma.user.createMany({
      data: ids.map((id) => ({
        id,
        username: `n_${id.slice(0, 8)}`,
        displayName: `N ${id.slice(0, 4)}`,
        email: `${id}@example.test`,
      })),
    });
    return ids;
  };

  const note = (
    recipientId: string,
    actorId: string | undefined,
    type: NotificationType,
    entityId?: string,
  ): CreateNotificationDto => ({
    recipientId,
    actorId,
    type,
    entityId,
    title: 't',
    body: 'b',
    metadata: {},
  });

  /** What the bell says now (Redis), and what the table says. */
  const cached = async (userId: string) =>
    Number(await redis.get(`notifications:unread:v2:${userId}`));
  const truth = async (userId: string) => {
    await redis.del(`notifications:unread:v2:${userId}`);
    return (await service.getUnreadCount(userId)).count;
  };
  /** Starts the counter from the table, as the first bell read does. */
  const warm = (userId: string) => service.getUnreadCount(userId);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    redis = new Redis(REDIS_URL);
    events = new EventEmitter2();
    service = new NotificationsService(
      prisma,
      stub<DomainEventService>({
        emit: jest.fn((type: string, data: unknown, targets?: string[]) => {
          emitted.push({ type, data, targets: targets ?? [] });
          return Promise.resolve();
        }),
      }),
      stub<ConfigService>({}),
      stub<RedisService>({ getClient: () => redis }),
      events,
      stub<BlocksService>({
        getExcludedUserIds: (userId: string) =>
          Promise.resolve(blocked.get(userId) ?? []),
        isBlocked: (a: string, b: string) =>
          Promise.resolve((blocked.get(a) ?? []).includes(b)),
      }),
    );
    service.onModuleInit();
  });

  afterAll(async () => {
    await redis.quit();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    emitted.length = 0;
    blocked.clear();
  });

  it('a second like on a still-unread row does not count it twice', async () => {
    const [r, a, b, c] = await users(4);
    await warm(r);
    await service.createNotification(note(r, a, NotificationType.LIKE, 'p1'));
    expect(await cached(r)).toBe(1);
    await service.createNotification(note(r, b, NotificationType.LIKE, 'p1'));
    expect(await cached(r)).toBe(1);
    await service.markAllAsRead(r);
    await service.createNotification(note(r, c, NotificationType.LIKE, 'p1'));
    expect(await cached(r)).toBe(1);
    expect(await truth(r)).toBe(1);
  });

  it('a repeat comment or follow on a still-unread row does not count it twice', async () => {
    const [r, a, b] = await users(3);
    await warm(r);
    await service.createNotification(
      note(r, a, NotificationType.COMMENT, 'p2'),
    );
    await service.createNotification(
      note(r, a, NotificationType.COMMENT, 'p2'),
    );
    await service.createNotification(note(r, b, NotificationType.FOLLOW, b));
    await service.createNotification(note(r, b, NotificationType.FOLLOW, b));
    expect(await cached(r)).toBe(2);
    expect(await truth(r)).toBe(2);
  });

  it('a repeated delete and two reads at once take a row off once', async () => {
    const [r, a, b, c] = await users(4);
    await warm(r);
    const rows = [];
    for (const actor of [a, b, c]) {
      rows.push(
        await service.createNotification(
          note(r, actor, NotificationType.COMMENT, `p-${actor}`),
        ),
      );
    }
    const [one, two] = rows.map((row) => row?.id ?? '');
    expect(await cached(r)).toBe(3);

    await service.deleteNotification(one, r);
    await expect(service.deleteNotification(one, r)).resolves.toEqual({
      success: true,
    });
    expect(await cached(r)).toBe(2);

    await Promise.all([service.markAsRead(two, r), service.markAsRead(two, r)]);
    expect(await cached(r)).toBe(1);
    expect(await truth(r)).toBe(1);

    await expect(
      service.deleteNotification(randomUUID(), r),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('hides a blocked person’s notifications from the list and the bell, and an unblock brings them back', async () => {
    const [r, x, y] = await users(3);
    await warm(r);
    await service.createNotification(
      note(r, x, NotificationType.COMMENT, 'p3'),
    );
    await service.createNotification(note(r, x, NotificationType.SYSTEM, 'p4'));
    await service.createNotification(
      note(r, y, NotificationType.COMMENT, 'p5'),
    );
    expect(await cached(r)).toBe(3);

    blocked.set(r, [x]);
    events.emit('user:blocked', {
      type: 'user:blocked',
      data: {},
      targetUserIds: [r],
    });
    await settle();
    expect(await cached(r)).toBe(2);
    const { data } = await service.getNotifications(r);
    const shown = data.map((n) => `${n.type}:${n.actorId}`).sort();
    // The SYSTEM row stays, exactly as delivery exempts it.
    expect(shown).toEqual([`COMMENT:${y}`, `SYSTEM:${x}`].sort());

    blocked.clear();
    events.emit('user:unblocked', {
      type: 'user:unblocked',
      data: {},
      targetUserIds: [r],
    });
    await settle();
    expect(await cached(r)).toBe(3);
  });

  it('creates one actor-less notification per entity, even when asked five times at once', async () => {
    const [r] = await users(1);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        service.createNotification(
          note(r, undefined, NotificationType.SYSTEM, 'p9'),
        ),
      ),
    );
    await Promise.all(
      Array.from({ length: 3 }, () =>
        service.createNotification(note(r, undefined, NotificationType.SYSTEM)),
      ),
    );
    const rows = await prisma.notification.findMany({
      where: { recipientId: r, actorId: null },
      select: { entityId: true },
    });
    // One for p9, one with no entity: the second batch was not swallowed by
    // the p9 row (an undefined entity used to mean "any entity").
    expect(rows.map((row) => row.entityId).sort()).toEqual([null, 'p9'].sort());
  });

  it('a follow row says whether the recipient follows back, in the list and live', async () => {
    const [r, a, b] = await users(3);
    await prisma.follow.create({ data: { followerId: r, followingId: a } });
    await service.createNotification(note(r, a, NotificationType.FOLLOW, a));
    await service.createNotification(note(r, b, NotificationType.FOLLOW, b));

    const { data } = await service.getNotifications(r);
    const byActor = new Map(data.map((n) => [n.actorId, n.actor]));
    expect(byActor.get(a)).toMatchObject({ id: a, isFollowing: true });
    expect(byActor.get(b)).toMatchObject({ id: b, isFollowing: false });

    const live = emitted
      .filter((e) => e.type === 'notification:new')
      .map((e) => e.data as { actor?: { id: string; isFollowing?: boolean } });
    expect(live.map((d) => [d.actor?.id, d.actor?.isFollowing])).toEqual([
      [a, true],
      [b, false],
    ]);
  });

  it('announces an activity invite once per invitee', async () => {
    const [host, one, two] = await users(3);
    await service.createActivityInviteNotifications({
      activityId: randomUUID(),
      inviterId: host,
      invitations: [
        { inviteeId: one, invitationId: randomUUID() },
        { inviteeId: two, invitationId: randomUUID() },
      ],
      activityTitle: 'Run',
      inviter: { id: host, name: 'Host', username: 'host' },
    });
    const news = emitted.filter((e) => e.type === 'notification:new');
    expect(news.map((e) => e.targets)).toEqual([[one], [two]]);
  });
});
