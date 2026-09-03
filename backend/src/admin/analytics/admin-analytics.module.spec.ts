import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAnalyticsModule } from './admin-analytics.module';
import { EmailUsageModule } from '../../email/email-usage.module';
import { EmailUsageService } from '../../email/email-usage.service';
import { RedisService } from '../../redis/redis.service';

/**
 * The DI wiring, which the unit tests around these services cannot see.
 *
 * Those construct services directly with `new`, so they pass whether or not the
 * module graph is correct. That gap let a real break through: EmailUsageService
 * was injected into AdminAnalyticsService without EmailUsageModule being
 * imported — which typechecks, passes every unit test, and then refuses to boot
 * with UnknownDependenciesException.
 *
 * Two things are checked, one per side of that mistake.
 */
describe('AdminAnalyticsModule wiring', () => {
  it('imports every module its service injects from', () => {
    // Compiling the full module drags in the controller and its admin guards,
    // which need most of AppModule. The invariant that actually broke is this
    // one, and it is checkable on its own.
    const imports = Reflect.getMetadata('imports', AdminAnalyticsModule) ?? [];
    expect(imports).toContain(EmailUsageModule);
  });

  it('declares every constructor dependency it resolves at runtime', () => {
    const params: unknown[] =
      Reflect.getMetadata('design:paramtypes', AdminAnalyticsService) ?? [];
    // The dependency that was missing must be a real, resolvable class rather
    // than `Object` — which is what an unresolvable import degrades to.
    expect(params).toContain(EmailUsageService);
  });

  it('EmailUsageModule actually exports the service, so importing it is enough', async () => {
    // The other half: importing a module that does not export the provider
    // fails identically at boot.
    const moduleRef = await Test.createTestingModule({
      imports: [EmailUsageModule],
    })
      .overrideProvider(RedisService)
      .useValue({ getClient: () => null })
      .compile();

    expect(moduleRef.get(EmailUsageService)).toBeInstanceOf(EmailUsageService);
    await moduleRef.close();
  });
});
