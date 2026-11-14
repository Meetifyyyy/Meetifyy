// EmailService pulls in sanitize-html, whose ESM dependency Jest cannot parse.
jest.mock('../../email/email.service', () => ({ EmailService: jest.fn() }));

import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthController } from './admin-auth.controller';
import type { AdminAuthService } from './admin-auth.service';
import type {
  RateLimitDecision,
  RateLimitService,
} from '../../common/rate-limit/rate-limit.service';
import { RATE_LIMIT_POLICIES_KEY } from '../../common/rate-limit/rate-limit.decorator';
import { stub } from '../../common/testing/stub';

/**
 * ADM-4: the admin per-account budget is spent only by a failed sign-in.
 * Charged up front, five requests from anywhere locked the owner out for
 * half an hour, and a correct sign-in counted against them too.
 */
describe('Admin sign-in lockout', () => {
  const decision = (allowed: boolean): RateLimitDecision => ({
    policy: 'admin.login.account',
    allowed,
    remaining: allowed ? 4 : 0,
    resetSeconds: 900,
    limit: 5,
    windowSeconds: 900,
    shadowed: false,
    degraded: false,
  });

  const build = (opts: { allowed?: boolean; fails?: boolean } = {}) => {
    const login = jest.fn(() =>
      opts.fails
        ? Promise.reject(new UnauthorizedException('Invalid credentials'))
        : Promise.resolve({ requiresOtp: true }),
    );
    const check = jest.fn((_p: string, _id: string) =>
      Promise.resolve(decision(opts.allowed ?? true)),
    );
    const penalize = jest.fn((_p: string, _id: string) => Promise.resolve());
    const controller = new AdminAuthController(
      stub<AdminAuthService>({ login }),
      stub<RateLimitService>({ check, penalize }),
    );
    const req = {
      ip: '203.0.113.9',
      headers: { 'user-agent': 'test' },
    } as unknown as Parameters<AdminAuthController['login']>[1];
    const signIn = () =>
      controller.login({ email: ' Owner@Example.Test ', password: 'pw' }, req);
    return { signIn, login, check, penalize };
  };

  it('spends nothing on a correct sign-in, however many there are', async () => {
    const t = build();
    for (let i = 0; i < 6; i += 1) await t.signIn();
    expect(t.penalize).not.toHaveBeenCalled();
    expect(t.check).toHaveBeenCalledWith(
      'admin.login.account',
      'owner@example.test',
    );
  });

  it('spends one point on a failed sign-in and returns its own error', async () => {
    const t = build({ fails: true });
    await expect(t.signIn()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.penalize).toHaveBeenCalledTimes(1);
    expect(t.penalize).toHaveBeenCalledWith(
      'admin.login.account',
      'owner@example.test',
    );
  });

  it('refuses before checking the password once the account budget is spent', async () => {
    const t = build({ allowed: false });
    const error = await t.signIn().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(t.login).not.toHaveBeenCalled();
  });

  it('leaves only the per-IP budget to the guard, which counts every attempt', () => {
    const policies = new Reflector().get<string[]>(
      RATE_LIMIT_POLICIES_KEY,
      AdminAuthController.prototype.login,
    );
    expect(policies).toEqual(['admin.login.ip']);
  });
});
