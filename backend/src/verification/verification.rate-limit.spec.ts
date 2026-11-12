import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerificationController } from './verification.controller';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import type { RateLimitDecision } from '../common/rate-limit/rate-limit.service';
import { RATE_LIMIT_POLICIES_KEY } from '../common/rate-limit/rate-limit.decorator';
import { JwtGuard } from '../common/guards';
import { stub } from '../common/testing/stub';

/**
 * `@RateLimit` is only metadata: nothing enforces it unless
 * RateLimitPolicyGuard is attached to the route. The capture route carried the
 * decorator without the guard, so its budget was never applied.
 */
describe('VerificationController capture rate limit', () => {
  const capture = VerificationController.prototype.capture;

  it('declares the per-user capture policy', () => {
    expect(
      new Reflector().get<string[]>(RATE_LIMIT_POLICIES_KEY, capture),
    ).toEqual(['verification.capture.user']);
  });

  it('mounts the policy guard on the handler', () => {
    const guards = Reflect.getMetadata('__guards__', capture) as unknown[];
    expect(guards).toContain(RateLimitPolicyGuard);
  });

  it('runs after JwtGuard, which supplies the user the policy is keyed on', () => {
    const classGuards = Reflect.getMetadata(
      '__guards__',
      VerificationController,
    ) as unknown[];
    expect(classGuards).toContain(JwtGuard);
  });

  it('no other handler on the controller declares a policy without the guard', () => {
    const reflector = new Reflector();
    for (const name of Object.getOwnPropertyNames(
      VerificationController.prototype,
    )) {
      if (name === 'constructor') continue;
      const handler = Reflect.get(
        VerificationController.prototype,
        name,
      ) as () => unknown;
      const declared = reflector.get<string[]>(
        RATE_LIMIT_POLICIES_KEY,
        handler,
      );
      if (!declared?.length) continue;
      expect(Reflect.getMetadata('__guards__', handler)).toContain(
        RateLimitPolicyGuard,
      );
    }
  });

  it('refuses a capture over the budget with a 429, keyed on the user id', async () => {
    const denied: RateLimitDecision = {
      policy: 'verification.capture.user',
      allowed: false,
      remaining: 0,
      resetSeconds: 1800,
      limit: 20,
      windowSeconds: 3600,
      shadowed: false,
      degraded: false,
    };
    const consumeAll = jest.fn(
      (_entries: Array<{ policy: string; identifier: string }>) =>
        Promise.resolve(denied),
    );
    const guard = new RateLimitPolicyGuard(
      new Reflector(),
      stub<RateLimitService>({ consumeAll }),
    );
    const context = stub<ExecutionContext>({
      getHandler: () => capture,
      getClass: () => VerificationController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'user-1' }, url: '/' }),
        getResponse: () => ({ setHeader: jest.fn(), removeHeader: jest.fn() }),
      }),
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(consumeAll).toHaveBeenCalledWith([
      { policy: 'verification.capture.user', identifier: 'user-1' },
    ]);
  });
});
