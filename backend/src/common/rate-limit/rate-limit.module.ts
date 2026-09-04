import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RateLimitPolicyGuard } from './rate-limit-policy.guard';

/**
 * Global so any guard or service can enforce a policy without a module having
 * to remember to import it — the same reasoning as RedisModule, which this
 * depends on and which is itself @Global.
 */
@Global()
@Module({
  providers: [RateLimitService, RateLimitPolicyGuard],
  exports: [RateLimitService, RateLimitPolicyGuard],
})
export class RateLimitModule {}
