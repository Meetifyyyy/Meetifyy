import { Reflector } from '@nestjs/core';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

/**
 * The installed app authenticates with a bearer token, which ordinary routes
 * refuse — and refuse for a good reason, recorded in
 * `allow-bearer-token.decorator.ts`: a bare token names no session, so the
 * checks behind "sign out this device", "sign out everywhere" and
 * password-change revocation have nothing to look up and were skipped
 * outright. Moving a token from a cookie jar into an `Authorization` header
 * defeated every one of them for up to an hour.
 *
 * The native client closes that gap by sending `x-session-id` beside the
 * token. These tests exist to prove two things at once, because the change is
 * only safe if BOTH hold:
 *
 *   1. A bearer that names a live, owned session is accepted.
 *   2. A bearer that does NOT is refused exactly as before — the old bypass
 *      stays closed, and naming a session buys no leniency about which one.
 *
 * Test 2 is the one that matters. If it ever goes green for the wrong reason,
 * the guard has stopped being a revocation point for the native client.
 */
describe('JwtGuard — native app session binding', () => {
  const USER = 'user-1';
  const OTHER = 'user-2';

  let guard: any;
  let sessions: Record<
    string,
    { revoked: boolean; expiresAt: Date; userId: string }
  >;
  let bearerAllowedOnRoute: boolean;

  const context = (
    {
      cookies = {},
      headers = {},
      method = 'GET',
    }: {
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
      method?: string;
    } = {},
  ) => ({
    switchToHttp: () => ({
      getRequest: () => ({ cookies, headers, method }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  });

  /** What the app sends: a bearer token plus the session it belongs to. */
  const nativeRequest = (sessionId: string, method = 'GET') =>
    context({
      headers: { authorization: 'Bearer tok', 'x-session-id': sessionId },
      method,
    });

  beforeEach(() => {
    bearerAllowedOnRoute = false;

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

    const prisma = {
      userSession: {
        findUnique: jest.fn(
          async ({ where }: any) => sessions[where.id] ?? null,
        ),
      },
    };

    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation(() => bearerAllowedOnRoute as any);

    guard = new JwtGuard({} as any, prisma as any, reflector, {
      isSatisfied: async () => true,
    } as any);

    guard.validateToken = jest.fn(async () => ({ id: USER, email: 'a@b.c' }));
    guard.enforceAccountStatus = jest.fn(async () => undefined);
    Object.defineProperty(guard, 'supabaseService', {
      value: { isConfigured: true },
      writable: true,
    });
  });

  afterEach(() => {
    Object.keys(sessions).forEach((id) => JwtGuard.forgetSession(id));
    jest.restoreAllMocks();
  });

  describe('the native path is accepted', () => {
    it('accepts a bearer token that names a live session it owns', async () => {
      await expect(guard.canActivate(nativeRequest('live-own'))).resolves.toBe(
        true,
      );
    });

    /**
     * A bearer caller cannot be CSRF'd: a page on another site cannot read the
     * token out of the device Keychain, so it cannot make the browser send
     * one. CSRF stays scoped to the cookie path, and a native mutation must
     * not be required to echo a cookie it does not have.
     */
    it('does not demand a CSRF header on a native mutation', async () => {
      await expect(
        guard.canActivate(nativeRequest('live-own', 'POST')),
      ).resolves.toBe(true);
    });
  });

  describe('the old bypass stays closed', () => {
    /**
     * The regression test for the whole change. Before session binding this
     * was the bypass; it must keep failing.
     */
    it('still refuses a bare bearer token on an ordinary route', async () => {
      await expect(
        guard.canActivate(context({ headers: { authorization: 'Bearer tok' } })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a bearer naming a REVOKED session', async () => {
      await expect(
        guard.canActivate(nativeRequest('revoked-own')),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a bearer naming an EXPIRED session', async () => {
      await expect(
        guard.canActivate(nativeRequest('expired-own')),
      ).rejects.toThrow(UnauthorizedException);
    });

    /**
     * Identity comes from the JWT and liveness from the session row, so an
     * unowned-but-live id would otherwise be a perfectly good liveness token
     * for somebody else's account.
     */
    it("refuses a bearer naming somebody else's live session", async () => {
      await expect(
        guard.canActivate(nativeRequest('live-other')),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a bearer naming a session that does not exist', async () => {
      await expect(guard.canActivate(nativeRequest('no-such-id'))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses an empty session id rather than treating it as absent', async () => {
      await expect(guard.canActivate(nativeRequest('   '))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('a cookie session cannot be downgraded by a header', () => {
    /**
     * If a header could override the cookie's `mf_sid`, anyone holding a
     * revoked cookie jar could pair it with a live id and carry on. The cookie
     * wins whenever the credential was a cookie.
     */
    it('uses the cookie id, not the header, when both are present', async () => {
      await expect(
        guard.canActivate(
          context({
            cookies: { mf_access: 'tok', mf_sid: 'revoked-own' },
            headers: { 'x-session-id': 'live-own' },
          }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('still refuses a cookie request whose own session id is missing', async () => {
      await expect(
        guard.canActivate(context({ cookies: { mf_access: 'tok' } })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('still demands CSRF on a cookie mutation', async () => {
      await expect(
        guard.canActivate(
          context({
            cookies: { mf_access: 'tok', mf_sid: 'live-own', mf_csrf: 'secret' },
            method: 'POST',
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('the signup handover is unchanged', () => {
    /**
     * `@AllowBearerToken` covers two routes where the session row does not
     * exist yet, because the call is on its way to creating it. A bare bearer
     * has to keep working there and nowhere else.
     */
    it('accepts a bare bearer on a route that opted in', async () => {
      bearerAllowedOnRoute = true;
      await expect(
        guard.canActivate(context({ headers: { authorization: 'Bearer tok' } })),
      ).resolves.toBe(true);
    });
  });
});
