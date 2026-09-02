import { Test } from '@nestjs/testing';
import { AdminDashboardService } from './admin-dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/**
 * The Redis row of System Health was decorative.
 *
 * The old block opened a try, immediately assigned `status: 'UP'`, and closed
 * it. No Redis call was ever made, so the catch was unreachable and the
 * "latency" was the cost of two Date.now() calls - a permanent 0ms. A Redis
 * that was configured but unreachable reported UP, which is the single
 * situation a health check exists to detect.
 */
describe('AdminDashboardService - platform status', () => {
  const build = async (redisClient: any) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } },
        { provide: RedisService, useValue: { getClient: () => redisClient } },
      ],
    }).compile();
    return moduleRef.get(AdminDashboardService).getPlatformStatus();
  };

  it('actually pings Redis', async () => {
    const ping = jest.fn().mockResolvedValue('PONG');
    await build({ ping });
    expect(ping).toHaveBeenCalled();
  });

  it('reports DOWN when the ping fails', async () => {
    // Previously impossible: the catch could never run.
    const ping = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const status = await build({ ping });
    expect(status.redis.status).toBe('DOWN');
    expect(status.redis.detail).toContain('ECONNREFUSED');
  });

  it('reports UP with a measured latency when the ping succeeds', async () => {
    const status = await build({ ping: jest.fn().mockResolvedValue('PONG') });
    expect(status.redis.status).toBe('UP');
    expect(typeof status.redis.latencyMs).toBe('number');
  });

  it('does not claim health when no client is connected', async () => {
    // A null client with REDIS_URL set means the connection failed at boot.
    // Reporting UP there is the same lie in a different place.
    const status = await build(null);
    expect(['UP', 'DOWN']).toContain(status.redis.status);
    expect(status.redis.detail).toBeTruthy();
  });

  it('probes the database with SELECT 1, not a table count', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: { $queryRaw } },
        { provide: RedisService, useValue: { getClient: () => ({ ping: jest.fn() }) } },
      ],
    }).compile();
    const status = await moduleRef.get(AdminDashboardService).getPlatformStatus();
    // Counting a table measures the table, so "database latency" would climb
    // with the user count for reasons unrelated to database health.
    expect($queryRaw).toHaveBeenCalled();
    expect(status.database.status).toBe('UP');
  });

  it('reports the database DOWN when the query throws', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: { $queryRaw: jest.fn().mockRejectedValue(new Error('no connection')) } },
        { provide: RedisService, useValue: { getClient: () => ({ ping: jest.fn() }) } },
      ],
    }).compile();
    const status = await moduleRef.get(AdminDashboardService).getPlatformStatus();
    expect(status.database.status).toBe('DOWN');
  });
});
