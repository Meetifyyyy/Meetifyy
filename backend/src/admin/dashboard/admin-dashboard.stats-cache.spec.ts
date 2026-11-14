import { AdminDashboardService } from './admin-dashboard.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { stub } from '../../common/testing/stub';

/**
 * ADM-13: the ten headline counts are polled every 30 s by every open
 * dashboard tab; they are computed once per 30 s instead.
 */
describe('Dashboard counts', () => {
  it('are counted once for tabs asking within the window', async () => {
    const count = jest.fn(() => Promise.resolve(3));
    const service = new AdminDashboardService(
      stub<PrismaService>({
        user: { count },
        college: { count },
        post: { count },
        community: { count },
        crewActivity: { count },
        report: { count },
        supportTicket: { count },
      }),
      stub<RedisService>(),
    );

    const first = await service.getStats();
    await service.getStats();
    await service.getStats();

    // Ten counts, once.
    expect(count).toHaveBeenCalledTimes(10);
    expect(first.totalUsers).toBe(3);
  });
});
