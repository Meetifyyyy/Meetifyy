import { dbStatsMiddleware } from './db-stats.middleware';
import {
  recordDbOperation,
  runWithDbStats,
  type RequestDbStats,
} from '../common/request-context/request-context';

describe('dbStatsMiddleware', () => {
  const run = dbStatsMiddleware();

  it('counts one operation and passes the result through', async () => {
    const stats: RequestDbStats = { queries: 0, dbMs: 0 };
    const result = await runWithDbStats(
      () => run('params', () => Promise.resolve({ rows: 2 })),
      stats,
    );
    expect(result).toEqual({ rows: 2 });
    expect(stats.queries).toBe(1);
    expect(stats.dbMs).toBeGreaterThanOrEqual(0);
  });

  it('adds up the time of each operation', async () => {
    const stats: RequestDbStats = { queries: 0, dbMs: 0 };
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await runWithDbStats(async () => {
      await run('a', () => wait(15));
      await run('b', () => wait(15));
    }, stats);
    expect(stats.queries).toBe(2);
    // Timers may fire a millisecond early; the point is that both are summed.
    expect(stats.dbMs).toBeGreaterThanOrEqual(25);
  });

  it('counts a query that fails, and rethrows its error', async () => {
    const stats: RequestDbStats = { queries: 0, dbMs: 0 };
    await expect(
      runWithDbStats(
        () => run('params', () => Promise.reject(new Error('boom'))),
        stats,
      ),
    ).rejects.toThrow('boom');
    expect(stats.queries).toBe(1);
  });

  it('does nothing, and does not throw, outside a request', async () => {
    await expect(run('params', () => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
    expect(() => recordDbOperation(5)).not.toThrow();
  });
});
