import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { dbStatsMiddleware } from './db-stats.middleware';
import {
  recordDbOperation,
  runWithDbStats,
  type RequestDbStats,
} from '../common/request-context/request-context';

/**
 * Which queries belong to which request, through the REAL Prisma library
 * engine and the real driver adapter — only the node-postgres pool underneath
 * is a fake that answers `SELECT`s from memory, so no database is involved.
 *
 * That is the point of running the engine: it calls back into JavaScript from
 * native code, and whether the request's AsyncLocalStorage survives that is
 * the whole question. These pin down where it does and where it does not.
 */
describe('attributing Prisma operations to a request', () => {
  const answer = {
    fields: [{ name: 'n', dataTypeID: 23 }],
    rows: [[1]],
    rowCount: 1,
  };
  /** What the pool and the `query` event did, whoever they were attributed to. */
  const seen = { poolCalls: 0, events: 0 };
  let prisma: PrismaClient<{
    adapter: PrismaPg;
    log: [{ emit: 'event'; level: 'query' }];
  }>;

  beforeAll(() => {
    const pool = new Pool({
      connectionString: 'postgresql://u:p@127.0.0.1:1/x',
    });
    const client = {
      query: () => {
        seen.poolCalls += 1;
        // If the store reached here, this would be counted against a request.
        recordDbOperation(0);
        return Promise.resolve(answer);
      },
      release: () => undefined,
    };
    Object.defineProperties(pool, {
      query: { value: client.query },
      connect: { value: () => Promise.resolve(client) },
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg(pool),
      log: [{ emit: 'event', level: 'query' }],
    });
    prisma.$on('query', () => {
      seen.events += 1;
      recordDbOperation(0);
    });
    prisma.$use(dbStatsMiddleware());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    seen.poolCalls = 0;
    seen.events = 0;
  });

  const tick = () => new Promise<void>((r) => setImmediate(r));

  it('keeps two concurrent requests apart, transactions and raw queries included', async () => {
    const a: RequestDbStats = { queries: 0, dbMs: 0 };
    const b: RequestDbStats = { queries: 0, dbMs: 0 };

    await Promise.all([
      runWithDbStats(async () => {
        await prisma.$queryRawUnsafe('SELECT 1');
        await tick();
        // Interactive transaction: two statements on its own connection.
        await prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe('SELECT 2');
          await tick();
          await tx.$queryRawUnsafe('SELECT 3');
        });
        // Batch transaction: two operations sent together.
        await prisma.$transaction([
          prisma.$queryRawUnsafe('SELECT 4'),
          prisma.$queryRawUnsafe('SELECT 5'),
        ]);
      }, a),
      runWithDbStats(async () => {
        await tick();
        await prisma.$queryRawUnsafe('SELECT 6');
        await prisma.$executeRawUnsafe('SELECT 7');
        await prisma.$queryRawUnsafe('SELECT 8');
      }, b),
    ]);

    expect(a.queries).toBe(5);
    expect(b.queries).toBe(3);
  });

  it('does not count, or throw on, a query made outside any request', async () => {
    const bystander: RequestDbStats = { queries: 0, dbMs: 0 };
    await runWithDbStats(() => Promise.resolve(), bystander);
    await expect(prisma.$queryRawUnsafe('SELECT 1')).resolves.toBeDefined();
    expect(bystander.queries).toBe(0);
  });

  it('is why counting is done in a middleware: the pool and the query event lose the request', async () => {
    const stats: RequestDbStats = { queries: 0, dbMs: 0 };
    await runWithDbStats(async () => {
      await prisma.$queryRawUnsafe('SELECT 1');
    }, stats);
    await tick();

    // Both fired for the query…
    expect(seen.poolCalls).toBeGreaterThan(0);
    expect(seen.events).toBeGreaterThan(0);
    // …and neither could attribute it: the only count is the middleware's. If
    // a Prisma upgrade makes these see the store, this fails — and a simpler
    // counting point (exact SQL statements) becomes possible.
    expect(stats.queries).toBe(1);
  });
});
