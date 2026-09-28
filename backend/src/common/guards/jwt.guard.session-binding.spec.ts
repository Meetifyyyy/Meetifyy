import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtGuard } from './jwt.guard';
import { stub } from '../testing/stub';
import {
  buildSessionGuard,
  httpContext,
  type SessionRow,
} from './testing/jwt-guard.fixture';

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

  let guard: JwtGuard;
  let sessions: Record<string, SessionRow>;

  const context = (cookies: Record<string, string>, method = 'GET') =>
    httpContext({ cookies, headers: {}, method });

  beforeEach(() => {
    sessions = {
      'live-own': {
        revoked: false,
        expiresAt: new Date(Date.now() + 8.64e7),
        userId: USER,
      },
      'revoked-own': {
        revoked: true,
        expiresAt: new Date(Date.now() + 8.64e7),
        userId: USER,
      },
      'expired-own': {
        revoked: false,
        expiresAt: new Date(Date.now() - 1000),
        userId: USER,
      },
      'live-other': {
        revoked: false,
        expiresAt: new Date(Date.now() + 8.64e7),
        userId: OTHER,
      },
    };

    // Isolate the session check: token verification and the lifecycle gates
    // have their own specs and would otherwise need a real JWT here.
    guard = buildSessionGuard({
      findSession: (id) => Promise.resolve(sessions[id] ?? null),
      user: { id: USER, email: 'a@b.c' },
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
    const failing = buildSessionGuard({
      findSession: () => {
        return Promise.reject(new Error('db down'));
      },
      user: { id: USER },
    });

    await expect(
      failing.canActivate(context({ mf_access: 'tok', mf_sid: 'live-own' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('CSRF, for cookie mutations only', () => {
    it('refuses a cookie mutation with no CSRF header', async () => {
      await expect(
        attempt(
          { mf_access: 'tok', mf_sid: 'live-own', mf_csrf: 'secret' },
          'POST',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a mismatched CSRF header', async () => {
      const ctx = httpContext({
        cookies: { mf_access: 'tok', mf_sid: 'live-own', mf_csrf: 'secret' },
        headers: { 'x-csrf-token': 'not-the-secret' },
        method: 'POST',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('accepts a matching CSRF header', async () => {
      const ctx = httpContext({
        cookies: {
          mf_access: 'tok',
          mf_sid: 'live-own',
          mf_csrf: 'secret',
        },
        headers: { 'x-csrf-token': 'secret' },
        method: 'POST',
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('refuses a bearer caller on a route that has not opted into one', async () => {
      // A bearer token names no session, so the revocation check above has
      // nothing to consult for it — which is exactly how lifting a token out of
      // a cookie jar and replaying it in an `Authorization` header used to
      // bypass "sign out this device", "sign out everywhere" and the revocation
      // a password change performs, for the token's full hour.
      const ctx = httpContext({
        cookies: {},
        headers: { authorization: 'Bearer tok' },
        method: 'POST',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('accepts a bearer caller on a route marked @AllowBearerToken', async () => {
      // The signup handover: `verifyOtp` has minted a provider session and no
      // cookie exists yet, because creating one is what the next call does.
      Object.assign(guard, {
        reflector: stub<Reflector>({
          getAllAndOverride: jest.fn(
            (key: string) => key === 'allowBearerToken',
          ),
        }),
      });
      const ctx = httpContext({
        cookies: {},
        headers: { authorization: 'Bearer tok' },
        method: 'POST',
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
