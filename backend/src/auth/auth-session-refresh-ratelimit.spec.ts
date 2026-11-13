// EmailService pulls in sanitize-html, which ships ESM that this Jest config
// does not transform; this suite reads route metadata and never constructs the
// controller (same mocks as auth-ratelimit-wiring.spec.ts).
jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));

import { ExecutionContext, HttpException, type Type } from '@nestjs/common';
import type { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { USER_REFRESH_COOKIE } from './session/user-session-cookies';
import { RateLimitGuard } from '../common/guards/ratelimit.guard';
import type { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { RATE_LIMIT_POLICIES } from '../config/rate-limit.config';
import type { RedisService } from '../redis/redis.service';
import { stub } from '../common/testing/stub';

/**
 * Session refresh, through the real policy guard and the real global guard.
 *
 * It used to be counted per IP, and an expired access token also put it in the
 * anonymous per-IP global tier, so a campus behind one address refreshing on
 * the hour limited and blocked itself. These tests run the actual guards (with
 * the in-process limiter, no Redis) against the real route's metadata.
 */
const POINTS = RATE_LIMIT_POLICIES['auth.session.refresh'].points;
const IP_POINTS = RATE_LIMIT_POLICIES['auth.session.refresh.ip'].points;

type Recorded = { setHeader(name: string, value: string): void };

function routeCtx(
  request: object,
  controller: Type<unknown> = AuthController,
  handler: (...args: never[]) => unknown = Reflect.get(
    AuthController.prototype,
    'refreshSession',
  ) as (...args: never[]) => unknown,
): ExecutionContext {
  const response: Recorded = { setHeader: () => undefined };
  return stub<ExecutionContext>({
    getType: jest.fn(() => 'http'),
    getHandler: jest.fn(() => handler),
    getClass: jest.fn(() => controller),
    switchToHttp: jest.fn(() =>
      stub<HttpArgumentsHost>({
        getRequest: jest.fn(() => request),
        getResponse: jest.fn(() => response),
      }),
    ),
  });
}

const refreshFrom = (token: string, ip = '203.0.113.7') => ({
  ip,
  path: '/api/auth/session/refresh',
  headers: {},
  cookies: { [USER_REFRESH_COOKIE]: token },
  body: {},
});

describe('POST /api/auth/session/refresh — rate limiting', () => {
  let svc: RateLimitService;
  let policyGuard: RateLimitPolicyGuard;

  beforeEach(() => {
    svc = new RateLimitService(stub<RedisService>({ getClient: () => null }));
    policyGuard = new RateLimitPolicyGuard(new Reflector(), svc);
  });

  const refresh = (request: object) =>
    policyGuard.canActivate(routeCtx(request));

  it('declares the per-token budget and the per-IP backstop, behind the policy guard', () => {
    const reflector = new Reflector();
    const handler = Reflect.get(AuthController.prototype, 'refreshSession') as (
      ...args: never[]
    ) => unknown;
    expect(reflector.get('rateLimit:policies', handler)).toEqual([
      'auth.session.refresh',
      'auth.session.refresh.ip',
    ]);
    expect(
      (Reflect.getMetadata('__guards__', handler) as unknown[]).includes(
        RateLimitPolicyGuard,
      ),
    ).toBe(true);
    expect(reflector.get('rateLimit:skipAnonymousGlobal', handler)).toBe(true);
  });

  it('keeps failing open when the store is unavailable', () => {
    expect(RATE_LIMIT_POLICIES['auth.session.refresh'].onRedisFailure).toBe(
      'open',
    );
    expect(RATE_LIMIT_POLICIES['auth.session.refresh.ip'].onRedisFailure).toBe(
      'open',
    );
  });

  it('gives two sessions behind one address separate budgets', async () => {
    for (let i = 0; i < POINTS; i++) {
      await refresh(refreshFrom('token-a'));
    }
    await expect(refresh(refreshFrom('token-a'))).rejects.toMatchObject({
      status: 429,
    });
    // The neighbour on the same NAT is untouched.
    await expect(refresh(refreshFrom('token-b'))).resolves.toBe(true);
  });

  it('limits one session that replays its token over the budget', async () => {
    for (let i = 0; i < POINTS; i++) {
      await expect(refresh(refreshFrom('token-loop'))).resolves.toBe(true);
    }
    const err = await refresh(refreshFrom('token-loop')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('follows the body token for a native client that has no cookie', async () => {
    const native = (token: string) => ({
      ip: '198.51.100.9',
      headers: {},
      cookies: {},
      body: { refreshToken: token },
    });
    for (let i = 0; i < POINTS; i++) await refresh(native('app-1'));
    await expect(refresh(native('app-1'))).rejects.toMatchObject({
      status: 429,
    });
    await expect(refresh(native('app-2'))).resolves.toBe(true);
  });

  it('still bounds one address that invents a fresh token per request', async () => {
    for (let i = 0; i < IP_POINTS; i++) {
      await refresh(refreshFrom(`made-up-${i}`, '192.0.2.50'));
    }
    await expect(
      refresh(refreshFrom('made-up-last', '192.0.2.50')),
    ).rejects.toMatchObject({ status: 429 });
    // A different address is not affected.
    await expect(
      refresh(refreshFrom('made-up-last', '192.0.2.51')),
    ).resolves.toBe(true);
  });

  it('does not put the raw refresh token into the limiter key', () => {
    const secretToken = 'raw-refresh-token-value-0123456789abcdef';
    const key = svc['buildKey'](
      'auth.session.refresh',
      RATE_LIMIT_POLICIES['auth.session.refresh'],
      secretToken,
    );
    expect(key).not.toContain(secretToken);
    expect(key.startsWith('auth.session.refresh:credential:')).toBe(true);
  });

  describe('global tier', () => {
    const expiredAccess = (n: number) => ({
      ip: '203.0.113.99',
      path: '/api/auth/session/refresh',
      headers: {},
      cookies: { [USER_REFRESH_COOKIE]: `t-${n}` },
      body: {},
    });
    // The access token is expired, so no identity can be proven.
    const anonymous = stub<JwtGuard>({
      peekUserId: () => Promise.resolve(null),
    });

    it('does not count the refresh route against the anonymous per-IP budget', async () => {
      const global = new RateLimitGuard(svc, anonymous, new Reflector());
      // global.ip is 120/min; a campus renewing at once is well past that.
      for (let i = 0; i < 300; i++) {
        await expect(
          global.canActivate(routeCtx(expiredAccess(i))),
        ).resolves.toBe(true);
      }
    });

    it('still counts every other anonymous route per IP', async () => {
      const global = new RateLimitGuard(svc, anonymous, new Reflector());
      class Other {
        read(): void {}
      }
      const other = (i: number) =>
        routeCtx(expiredAccess(i), Other, Other.prototype.read);
      let rejected: unknown = null;
      for (let i = 0; i < 200 && !rejected; i++) {
        await global.canActivate(other(i)).catch((e: unknown) => {
          rejected = e;
        });
      }
      expect(rejected).toBeInstanceOf(HttpException);
    });

    it('still counts a refresh that carries a valid token per user', async () => {
      const known = stub<JwtGuard>({
        peekUserId: () => Promise.resolve('user-1'),
      });
      const global = new RateLimitGuard(svc, known, new Reflector());
      const request = {
        ...expiredAccess(1),
        headers: { authorization: 'Bearer valid' },
      };
      for (let i = 0; i < 300; i++) {
        await global.canActivate(routeCtx(request));
      }
      await expect(global.canActivate(routeCtx(request))).rejects.toMatchObject(
        { status: 429 },
      );
    });
  });
});
