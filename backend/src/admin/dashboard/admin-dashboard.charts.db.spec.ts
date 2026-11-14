import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { stub } from '../../common/testing/stub';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * The registrations chart counted in Postgres (ADM-14): each sign-up lands on
 * the server's local calendar day, deleted accounts are left out, and nothing
 * older than the 30-day window is counted.
 *
 * Needs a disposable database with every migration applied, named in BOTH
 * `DATABASE_URL` and `ADMIN_TEST_DATABASE_URL`, on localhost. Skipped
 * otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.ADMIN_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('Registrations chart (database)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const localKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  /** Local `hour`:00 on the day `n` days ago. */
  const at = (n: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const user = (createdAt: Date, deletedAt: Date | null = null) => {
    const id = randomUUID();
    return prisma.user.create({
      data: {
        id,
        username: `r_${id.slice(0, 8)}`,
        displayName: 'R',
        email: `${id}@example.test`,
        createdAt,
        deletedAt,
      },
    });
  };

  it('counts each sign-up on its local day, without deleted or older accounts', async () => {
    // Early and late on the same local days: they cross midnight in UTC for
    // any zone away from it, which is exactly what used to land on the wrong bar.
    await user(at(1, 0));
    await user(at(1, 23));
    await user(at(5, 12));
    await user(at(0, 1), new Date());
    await user(at(40, 12));

    const { registrations } = await new AdminDashboardService(
      prisma,
      stub<RedisService>(),
    ).getCharts();

    const byDay = new Map(registrations.map((r) => [r.date, r.registrations]));
    expect(byDay.get(localKey(at(1, 12)))).toBe(2);
    expect(byDay.get(localKey(at(5, 12)))).toBe(1);
    expect(byDay.get(localKey(at(0, 12)))).toBe(0);
    expect(registrations.reduce((s, r) => s + r.registrations, 0)).toBe(3);
  });
});
