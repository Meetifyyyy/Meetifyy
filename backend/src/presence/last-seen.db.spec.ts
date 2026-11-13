import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../common/testing/stub';
import type { RedisService } from '../redis/redis.service';
import { PresenceService } from './presence.service';

/**
 * The presence write against a real Postgres: `lastSeenAt` alone, as a HOT
 * update (migration 44 dropped its index), leaving `updatedAt` where it was.
 *
 * Needs a disposable database with every migration applied, named in BOTH
 * `DATABASE_URL` and `PRESENCE_TEST_DATABASE_URL`, on localhost. Skipped
 * otherwise, so it can never run against a shared database.
 */
const TEST_URL = process.env.PRESENCE_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

describeDb('Last seen (database)', () => {
  let prisma: PrismaService;
  let service: PresenceService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new PresenceService(
      stub<RedisService>({ getClient: () => null }),
      prisma,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const hotUpdates = async () => {
    // Returns void, which a query cannot read back.
    await prisma.$executeRaw`SELECT pg_stat_force_next_flush()`;
    const [row] = await prisma.$queryRaw<Array<{ hot: number }>>`
      SELECT n_tup_hot_upd::int AS hot FROM pg_stat_user_tables
      WHERE relname = 'User'`;
    return row.hot;
  };

  it('stamps lastSeenAt in place and leaves updatedAt alone', async () => {
    const id = randomUUID();
    const edited = new Date('2026-01-01T00:00:00.000Z');
    await prisma.user.create({
      data: {
        id,
        username: `seen_${id.slice(0, 8)}`,
        displayName: 'Seen',
        email: `${id}@example.test`,
        bio: 'Likes chess, music and late-night DSA practice',
      },
    });
    // Set apart from the create so the row is settled before the measured write.
    await prisma.$executeRaw`UPDATE "User" SET "updatedAt" = ${edited} WHERE "id" = ${id}`;
    const before = await hotUpdates();

    await service['touchLastSeen'](id);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { lastSeenAt: true, updatedAt: true },
    });
    expect(row.lastSeenAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toEqual(edited);
    expect(await hotUpdates()).toBe(before + 1);
  });

  it('migration 44: no index on lastSeenAt, and room on each page for HOT updates', async () => {
    const [found] = await prisma.$queryRaw<
      Array<{ indexed: boolean; options: string[] | null }>
    >`SELECT
        EXISTS (SELECT 1 FROM pg_indexes
                WHERE tablename = 'User' AND indexdef LIKE '%"lastSeenAt"%') AS indexed,
        (SELECT reloptions FROM pg_class WHERE relname = 'User') AS options`;
    expect(found.indexed).toBe(false);
    expect(found.options).toContain('fillfactor=90');
  });
});
