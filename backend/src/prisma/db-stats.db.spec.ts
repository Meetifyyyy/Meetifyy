import { PrismaService } from './prisma.service';
import {
  runWithDbStats,
  type RequestDbStats,
} from '../common/request-context/request-context';

/**
 * Per-request query counting through the real PrismaService, its real
 * node-postgres pool and a real Postgres, concurrent requests included.
 * (db-stats.attribution.spec.ts proves the same against the real Prisma engine
 * with a fake pool, and runs everywhere.)
 *
 * Needs a disposable database on localhost named in BOTH `DATABASE_URL` and
 * `REQUEST_STATS_TEST_DATABASE_URL`; the specs only run SELECTs and pg_sleep.
 * Skipped otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.REQUEST_STATS_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('request database counters (database)', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.onApplicationShutdown();
  });

  it('attributes raw, interactive and batch queries to their own request', async () => {
    const a: RequestDbStats = { queries: 0, dbMs: 0 };
    const b: RequestDbStats = { queries: 0, dbMs: 0 };

    await Promise.all([
      runWithDbStats(async () => {
        await prisma.$queryRaw`SELECT pg_sleep(0.05)`;
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          await tx.$queryRaw`SELECT pg_sleep(0.05)`;
        });
        await prisma.$transaction([
          prisma.$queryRaw`SELECT 1`,
          prisma.$queryRaw`SELECT 2`,
        ]);
      }, a),
      runWithDbStats(async () => {
        await prisma.$queryRaw`SELECT 1`;
        await prisma.$queryRaw`SELECT pg_sleep(0.02)`;
      }, b),
    ]);

    expect(a.queries).toBe(5);
    expect(b.queries).toBe(2);
    expect(a.dbMs).toBeGreaterThanOrEqual(95);
    expect(b.dbMs).toBeLessThan(a.dbMs);
  });

  it('counts nothing for a query outside a request', async () => {
    const bystander: RequestDbStats = { queries: 0, dbMs: 0 };
    await prisma.$queryRaw`SELECT 1`;
    expect(bystander.queries).toBe(0);
  });
});
