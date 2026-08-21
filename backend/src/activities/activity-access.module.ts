import { Module } from '@nestjs/common';
import { ActivityAuthorizationService } from './activity-authorization.service';

/**
 * The activity access policy in a module of its own so every consumer — the
 * activities module, search, and the realtime gateway — can import the SAME
 * policy without creating a circular dependency between feature modules.
 *
 * The policy is a pure decision service (no injected dependencies), which keeps
 * this module free of any import of its own.
 */
@Module({
  providers: [ActivityAuthorizationService],
  exports: [ActivityAuthorizationService],
})
export class ActivityAccessModule {}
