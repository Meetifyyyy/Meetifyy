import { Test } from '@nestjs/testing';
import { AdminDashboardService } from './admin-dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/**
 * The registrations chart read as a flat zero line on a platform with users.
 *
 * It built 30 buckets starting at `now - 30 days` and stepped forward 29 times,
 * so the last bucket was YESTERDAY. Anything created today fell outside the map
 * and was dropped by the `!== undefined` guard rather than counted. On a young
 * platform most sign-ups are recent, so most of the data was invisible - which
 * is exactly what the dashboard showed: 37 users, 37 new registrations, and a
 * chart pinned to zero.
 */
describe('AdminDashboardService - registrations chart', () => {
  let service: AdminDashboardService;
  let findMany: jest.Mock;

  const build = async (createdAt: Date[]) => {
    findMany = jest.fn().mockResolvedValue(createdAt.map((d) => ({ createdAt: d })));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: { user: { findMany } } },
        { provide: RedisService, useValue: { getClient: () => null } },
      ],
    }).compile();
    service = moduleRef.get(AdminDashboardService);
    return service.getCharts();
  };

  /** Local midnight n days ago, matching how the service builds its buckets. */
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0); // midday, so a timezone shift cannot move the day
    d.setDate(d.getDate() - n);
    return d;
  };

  const localKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('returns exactly 30 days', async () => {
    const { registrations } = await build([]);
    expect(registrations).toHaveLength(30);
  });

  it('ends on TODAY, not yesterday', async () => {
    // The whole bug in one assertion.
    const { registrations } = await build([]);
    expect(registrations.at(-1)!.date).toBe(localKey(new Date()));
  });

  it('counts a registration made today', async () => {
    const { registrations } = await build([daysAgo(0)]);
    const today = registrations.at(-1)!;
    expect(today.registrations).toBe(1);
  });

  it('counts every registration it was given, losing none', async () => {
    // 37 accounts created today: the exact shape of the reported dashboard.
    const { registrations } = await build(Array.from({ length: 37 }, () => daysAgo(0)));
    const total = registrations.reduce((sum, r) => sum + r.registrations, 0);
    expect(total).toBe(37);
    expect(registrations.at(-1)!.registrations).toBe(37);
  });

  it('places older registrations in their own day', async () => {
    const { registrations } = await build([daysAgo(0), daysAgo(1), daysAgo(1), daysAgo(5)]);
    const byDate = new Map(registrations.map((r) => [r.date, r.registrations]));
    expect(byDate.get(localKey(daysAgo(0)))).toBe(1);
    expect(byDate.get(localKey(daysAgo(1)))).toBe(2);
    expect(byDate.get(localKey(daysAgo(5)))).toBe(1);
  });

  it('starts 29 days before today, so the window is inclusive at both ends', async () => {
    const { registrations } = await build([]);
    expect(registrations[0].date).toBe(localKey(daysAgo(29)));
  });

  it('returns days in ascending order', async () => {
    const { registrations } = await build([]);
    const dates = registrations.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('excludes deleted accounts from the query', async () => {
    // The chart used to count soft-deleted users while the "Total Users" card
    // beside it did not, so the two disagreed.
    await build([]);
    expect(findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it('keys buckets by local date, matching how getStats defines "today"', async () => {
    /**
     * Buckets were keyed with toISOString(), i.e. UTC, while getStats counts
     * from local midnight. In IST that put every sign-up between 05:30 and
     * midnight on the wrong bar.
     */
    const { registrations } = await build([]);
    for (const row of registrations) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(registrations.at(-1)!.date).toBe(localKey(new Date()));
  });
});
