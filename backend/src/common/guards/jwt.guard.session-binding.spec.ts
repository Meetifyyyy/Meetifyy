import { Reflector } from '@nestjs/core';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

/**
 * The session cookie is the mechanism that makes a session revocable, so the
 * ways it can be lied about are the ways revocation can be defeated.
 *
 * Two of them were live, and both were found by replaying a revoked session
 * rather than by reading the code:
 *
 *   1. The id's absence skipped the check. A stolen cookie jar with `mf_sid`
 *      removed sailed past it, so "sign out this device" did nothing against
 *      precisely the attacker it exists to stop.
 *   2. The id was never checked against the token's user. Pairing a revoked
 *      access token with a live session id from ANY account — the attacker's
 *      own, for instance — was accepted, and the response carried the victim's
 *      profile: identity came from the JWT while liveness came from an
 *      unrelated row.
 */
describe('JwtGuard — session binding', () => {
  const USER = 'user-1';
  const OTHER = 'user-2';

  let guard: any;
  let sessions: Record<string, { revoked: boolean; expiresAt: Date; userId: string }>;

  const context = (cookies: Record<string, string>, method = 'GET') => ({
    switchToHttp: () => ({
      getRequest: () => ({ cookies, headers: {}, method }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  });

  beforeEach(() => {
    sessions = {
      'live-own': { revoked: false, expiresAt: new Date(Date.now() + 8.64e7), userId: USER },
      'revoked-own': { revoked: true, expiresAt: new Date(Date.now() + 8.64e7), userId: USER },
      'expired-own': { revoked: false, expiresAt: new Date(Date.now() - 1000), userId: USER },
      'live-other': { revoked: false, expiresAt: new Date(Date.now() + 8.64e7), userId: OTHER },
    };

    const prisma = {
      userSession: {
        findUnique: jest.fn(async ({ where }: any) => sessions[where.id] ?? null),
      },
    };

    guard = new JwtGuard({} as any, prisma as any, new Reflector(), {
      isSatisfied: async () => true,
    } as any);

    // Isolate the session check: token verification and the lifecycle gates
    // have their own specs and would otherwise need a real JWT here.
    guard.validateToken = jest.fn(async () => ({ id: USER, email: 'a@b.c' }));
    guard.enforceAccountStatus = jest.fn(async () => undefined);
    (guard as any).supabaseService = { isConfigured: true };
    Object.defineProperty(guard, 'supabaseService', {
      value: { isConfigured: true },
      writable: true,
    });
  });

  afterEach(() => {
    Object.keys(sessions).forEach((id) => JwtGuard.forgetSession(id));
  });

  const attempt = (cookies: Record<string, string>, method = 'GET') =>
    guard.canActivate(context(cookies, method));

  it('accepts a live session belonging to the caller', async () => {
    await expect(
      attempt({ mf_access: 'tok', mf_sid: 'live-own' }),
    ).resolves.toBe(true);
  });

  it('refuses a cookie request with no session id at all', async () => {
    // The bypass: drop one cookie and the check used to be skipped entirely.
    await expect(attempt({ mf_access: 'tok' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses an empty session id', async () => {
    await expect(
      attempt({ mf_access: 'tok', mf_sid: '' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a live session belonging to somebody else', async () => {
    // The worse bypass: any live session vouching for any token.
    await expect(
      attempt({ mf_access: 'tok', mf_sid: 'live-other' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a revoked session', async () => {
    await expect(
      attempt({ mf_access: 'tok', mf_sid: 'revoked-own' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an expired session', async () => {
    await expect(
      attempt({ mf_access: 'tok', mf_sid: 'expired-own' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a session id that does not exist', async () => {
    await expect(
      attempt({ mf_access: 'tok', mf_sid: 'no-such-session' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the session lookup throws', async () => {
    const prisma = {
      userSession: {
        findUnique: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    const failing = new JwtGuard({} as any, prisma as any, new Reflector(), {
      isSatisfied: async () => true,
    } as any) as any;
    failing.validateToken = jest.fn(async () => ({ id: USER }));
    failing.enforceAccountStatus = jest.fn(async () => undefined);
    Object.defineProperty(failing, 'supabaseService', {
      value: { isConfigured: true },
      writable: true,
    });

    await expect(
      failing.canActivate(context({ mf_access: 'tok', mf_sid: 'live-own' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('CSRF, for cookie mutations only', () => {
    it('refuses a cookie mutation with no CSRF header', async () => {
      await expect(
        attempt({ mf_access: 'tok', mf_sid: 'live-own', mf_csrf: 'secret' }, 'POST'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a mismatched CSRF header', async () => {
      const ctx: any = context(
        { mf_access: 'tok', mf_sid: 'live-own', mf_csrf: 'secret' },
        'POST',
      );
      ctx.switchToHttp = () => ({
        getRequest: () => ({
          cookies: { mf_access: 'tok', mf_sid: 'live-own', mf_csrf: 'secret' },
          headers: { 'x-csrf-token': 'not-the-secret' },
          method: 'POST',
        }),
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('accepts a matching CSRF header', async () => {
      const ctx: any = {
        switchToHttp: () => ({
          getRequest: () => ({
            cookies: { mf_access: 'tok', mf_sid: 'live-own', mf_csrf: 'secret' },
            headers: { 'x-csrf-token': 'secret' },
            method: 'POST',
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      };
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('leaves a bearer caller alone — it cannot be forged cross-site', async () => {
      const ctx: any = {
        switchToHttp: () => ({
          getRequest: () => ({
            cookies: {},
            headers: { authorization: 'Bearer tok' },
            method: 'POST',
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      };
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
