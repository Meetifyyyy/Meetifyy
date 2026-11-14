import { AdminAnalyticsService } from './admin-analytics.service';
import type { InfrastructureReport } from './admin-analytics.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { EmailUsageService } from '../../email/email-usage.service';
import type { SlowRequestRetentionService } from '../../observability/slow-request-retention.service';
import { stub } from '../../common/testing/stub';

/**
 * ADM-15: the infrastructure probes (Redis, R2 list pages, email providers,
 * Azure) run once per 30 s, shared by every open analytics tab.
 */
describe('Infrastructure panel', () => {
  it('probes once for tabs asking within the window', async () => {
    const service = new AdminAnalyticsService(
      stub<PrismaService>(),
      stub<RedisService>(),
      stub<EmailUsageService>(),
      stub<SlowRequestRetentionService>(),
    );
    const report: InfrastructureReport = {
      generatedAt: new Date().toISOString(),
      services: [],
      unconfigured: [],
    };
    const probe = jest.fn(() => Promise.resolve(report));
    service['probeInfrastructure'] = probe;

    const [a, b] = await Promise.all([
      service.getInfrastructure(),
      service.getInfrastructure(),
    ]);
    await service.getInfrastructure();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(a).toBe(report);
    expect(b).toBe(report);
  });
});
