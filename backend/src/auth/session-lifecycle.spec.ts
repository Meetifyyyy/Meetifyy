jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));

import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthController } from './auth.controller';
import { UserSessionRevokedReason } from '@prisma/client';
import { ProviderRefreshUnavailableError } from './auth.service';
import type { AuthService } from './auth.service';
import type { JwtGuard } from '../common/guards/jwt.guard';
import type { EmailService } from '../email/email.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import type { UserSessionService } from './session/user-session.service';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import {
  cookiesClearedOn,
  cookiesSetOn,
  createMockRequest,
  createMockResponse,
  type MockRequestInit,
  type MockResponse,
} from '../common/testing/express.mock';
import { stub } from '../common/testing/stub';

/**
 * The session lifecycle, as seen from the routes that own it.
 *
 * Three defects are pinned here, all of which presented to users as "I was
 * signed out for no reason" or, worse, as somebody else's account appearing in
 * their browser:
 *
 *   • Login handed the browser the PROVIDER refresh token. Supabase retires a
 *     refresh token the moment it is used, and the server keeps a copy of the
 *     same one — so whichever side refreshed first invalidated the other, and
 *     replaying the retired one trips the provider's reuse detection, which
 *     revokes every session the account has.
 *
 *   • Signing out never reached the server. The row stayed live and the
 *     HttpOnly cookies stayed in the browser, so the next reload signed the
 *     person back in — and on a shared machine, signed the next person in.
 *
 *   • Signing out required a valid access token, which is exactly what the
 *     people who most need to sign out do not have.
 */
describe('AuthController — session lifecycle', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    syncProfile: jest.Mock;
    refreshProviderSession: jest.Mock;
  };
  let jwtGuard: { validateToken: jest.Mock };
  let sessions: {
    issue: jest.Mock;
    hashRefreshToken: jest.Mock;
    revokeByRefreshHash: jest.Mock;
    revokeOwnedByUser: jest.Mock;
  };
  let res: MockResponse;

  const cookiesSet = () => cookiesSetOn(res);

  const makeController = (
    emailService: object = {
      sendNewLoginEmail: jest.fn().mockResolvedValue(undefined),
    },
  ) =>
    new AuthController(
      stub<AuthService>(authService),
      emailService as EmailService,
      stub<RateLimitService>({
        consume: jest.fn().mockResolvedValue({ allowed: true }),
        penalize: jest.fn().mockResolvedValue(undefined),
      }),
      stub<UserSessionService>(sessions),
      stub<JwtGuard>(jwtGuard),
    );

  beforeEach(() => {
    authService = {
      login: jest.fn().mockResolvedValue({
        session: {
          access_token: 'provider-access',
          refresh_token: 'provider-refresh',
          expires_in: 3600,
        },
        user: { id: 'u1', email: 'a@b.c', displayName: 'A' },
      }),
      syncProfile: jest.fn().mockResolvedValue({ id: 'u1', username: 'a' }),
      // What Supabase answers when it accepts the refresh token handed over at
      // signup: a rotated pair, distinct from the ones the browser presented.
      refreshProviderSession: jest.fn().mockResolvedValue({
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      }),
    };
    jwtGuard = {
      validateToken: jest.fn((token: string) =>
        Promise.resolve(
          token === 'rotated-access'
            ? { id: 'u1', email: 'a@b.c', user_metadata: {}, token }
            : null,
        ),
      ),
    };
    sessions = {
      issue: jest.fn().mockResolvedValue({
        sessionId: 's1',
        familyId: 'f1',
        refreshToken: 'our-refresh',
        expiresAt: new Date(Date.now() + 86400000),
      }),
      hashRefreshToken: jest.fn((t: string) => `hash:${t}`),
      revokeByRefreshHash: jest.fn().mockResolvedValue(undefined),
      revokeOwnedByUser: jest.fn().mockResolvedValue(true),
    };
    res = createMockResponse();
    controller = makeController();
  });

  const req = (init: MockRequestInit = {}) => createMockRequest(init);

  describe('login', () => {
    it('returns no provider token of any kind to the browser', async () => {
      const body = await controller.login(
        { identifier: 'a', password: 'p' },
        req(),
        res,
      );

      const serialised = JSON.stringify(body);
      expect(serialised).not.toContain('provider-refresh');
      expect(serialised).not.toContain('provider-access');
      expect((body as { session?: unknown }).session).toBeUndefined();
    });

    it('keeps the provider refresh token server-side, sealed into the session', async () => {
      await controller.login({ identifier: 'a', password: 'p' }, req(), res);
      expect(sessions.issue).toHaveBeenCalledWith(
        'u1',
        expect.anything(),
        'provider-refresh',
      );
    });

    it('sets the access token as an HttpOnly cookie, not a response field', async () => {
      await controller.login({ identifier: 'a', password: 'p' }, req(), res);
      const set = cookiesSet();
      expect(set.mf_access).toBe('provider-access');
      expect(set.mf_refresh).toBe('our-refresh');
      expect(set.mf_sid).toBe('s1');
    });

    it('returns the full profile, so the client needs no second request', async () => {
      // The client used to sign in and then ask who it had just signed in as,
      // treating a failure of that second call as a failed login. One response
      // answers both questions and leaves no window to lose.
      const body = await controller.login(
        { identifier: 'a', password: 'p' },
        req(),
        res,
      );
      expect(body.user).toEqual({ id: 'u1', username: 'a' });
      expect(authService.syncProfile).toHaveBeenCalled();
    });

    it('provisions the profile before creating the session row that points at it', async () => {
      // UserSession.userId is a foreign key to User. A verified account with no
      // User row yet — a signup whose handover never finished — used to pass
      // the password check and then 500 on the session insert, on every
      // attempt. syncProfile is what creates that row, so it has to run first.
      await controller.login({ identifier: 'a', password: 'p' }, req(), res);
      expect(authService.syncProfile.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.issue.mock.invocationCallOrder[0],
      );
    });

    it('issues no session and sends no sign-in email when the profile refuses', async () => {
      // A banned account, for example. Nothing should be created for it, and
      // nobody should be told a sign-in happened.
      const emailService = { sendNewLoginEmail: jest.fn() };
      controller = makeController(emailService);
      authService.syncProfile.mockRejectedValueOnce(
        new ForbiddenException('Account has been banned'),
      );

      await expect(
        controller.login({ identifier: 'a', password: 'p' }, req(), res),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(sessions.issue).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
      expect(emailService.sendNewLoginEmail).not.toHaveBeenCalled();
    });

    it('hands back the CSRF token so a page that cannot read the cookie can still echo it', async () => {
      const body = await controller.login(
        { identifier: 'a', password: 'p' },
        req(),
        res,
      );
      expect(body.csrfToken).toEqual(expect.any(String));
      expect(body.csrfToken).toBe(cookiesSet().mf_csrf);
    });
  });

  describe('adoptSession', () => {
    const user: AuthenticatedUser = {
      id: 'u1',
      email: 'a@b.c',
      user_metadata: {},
      token: 'provider-access',
    };
    const adopt = (init: MockRequestInit = {}) =>
      controller.adoptSession(
        { refreshToken: 'provider-refresh' },
        user,
        req(init),
        res,
      );

    const expectNothingCreated = () => {
      expect(authService.syncProfile).not.toHaveBeenCalled();
      expect(sessions.issue).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    };

    it('provisions the profile before creating the session row that points at it', async () => {
      // Adoption is a brand-new account's first request, so its User row may
      // not exist yet; the session insert would fail on the foreign key.
      await adopt();
      expect(authService.syncProfile.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.issue.mock.invocationCallOrder[0],
      );
    });

    it('issues nothing when the profile cannot be provisioned', async () => {
      authService.syncProfile.mockRejectedValueOnce(
        new UnauthorizedException('Email verification required.'),
      );
      await expect(adopt()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.issue).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('spends the refresh token at the provider before anything else happens', async () => {
      await adopt();
      expect(authService.refreshProviderSession).toHaveBeenCalledWith(
        'provider-refresh',
      );
      expect(
        authService.refreshProviderSession.mock.invocationCallOrder[0],
      ).toBeLessThan(authService.syncProfile.mock.invocationCallOrder[0]);
    });

    it('refuses a refresh token the provider rejects, and creates nothing', async () => {
      // A bearer that outlived "sign out everywhere", paired with any string.
      authService.refreshProviderSession.mockResolvedValueOnce(null);
      await expect(adopt()).rejects.toBeInstanceOf(UnauthorizedException);
      expectNothingCreated();
    });

    it('answers 503, not 401, and creates nothing when the provider is unavailable', async () => {
      authService.refreshProviderSession.mockRejectedValueOnce(
        new ProviderRefreshUnavailableError(),
      );
      await expect(adopt()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expectNothingCreated();
    });

    it('lets any other provider failure propagate', async () => {
      const boom = new Error('unexpected');
      authService.refreshProviderSession.mockRejectedValueOnce(boom);
      await expect(adopt()).rejects.toBe(boom);
      expectNothingCreated();
    });

    it('refuses a refresh token that belongs to a different account', async () => {
      jwtGuard.validateToken.mockResolvedValueOnce({
        id: 'someone-else',
        email: 'x@y.z',
        user_metadata: {},
        token: 'rotated-access',
      });
      await expect(adopt()).rejects.toBeInstanceOf(UnauthorizedException);
      expectNothingCreated();
    });

    it('refuses when the refreshed access token cannot be verified', async () => {
      jwtGuard.validateToken.mockResolvedValueOnce(null);
      await expect(adopt()).rejects.toBeInstanceOf(UnauthorizedException);
      expectNothingCreated();
    });

    it('verifies the NEW access token, not the bearer', async () => {
      await adopt();
      expect(jwtGuard.validateToken).toHaveBeenCalledWith('rotated-access');
    });

    it('seals the rotated provider refresh token, not the one in the body', async () => {
      await adopt();
      expect(sessions.issue).toHaveBeenCalledWith(
        'u1',
        expect.anything(),
        'rotated-refresh',
      );
      expect(sessions.issue).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'provider-refresh',
      );
    });

    it('sets the rotated access token as the cookie', async () => {
      await adopt();
      const set = cookiesSet();
      expect(set.mf_access).toBe('rotated-access');
      expect(set.mf_refresh).toBe('our-refresh');
      expect(set.mf_sid).toBe('s1');
    });

    it('hands the installed app the rotated access token and keeps the response shape', async () => {
      const body = await adopt({ headers: { origin: 'https://localhost' } });
      expect(Object.keys(body).sort()).toEqual(
        [
          'accessToken',
          'csrfToken',
          'expiresIn',
          'meta',
          'refreshToken',
          'sessionId',
          'user',
        ].sort(),
      );
      expect(body).toMatchObject({
        accessToken: 'rotated-access',
        refreshToken: 'our-refresh',
        sessionId: 's1',
      });
      expect(JSON.stringify(body)).not.toContain('rotated-refresh');
      expect(JSON.stringify(body)).not.toContain('provider-access');
    });

    it('sends a website no tokens in the body', async () => {
      const body = await adopt();
      expect(Object.keys(body).sort()).toEqual(
        ['csrfToken', 'meta', 'sessionId', 'user'].sort(),
      );
    });
  });

  describe('signing in again from a device that still holds a session', () => {
    it('ends the previous session instead of listing the device twice', async () => {
      await controller.login(
        { identifier: 'a', password: 'p' },
        req({ cookies: { mf_sid: 'old-session' } }),
        res,
      );
      expect(sessions.revokeOwnedByUser).toHaveBeenCalledWith(
        'u1',
        'old-session',
        UserSessionRevokedReason.USER_LOGOUT,
      );
    });

    it('records an app login as the app', async () => {
      await controller.login(
        { identifier: 'a', password: 'p' },
        req({ headers: { origin: 'https://localhost' } }),
        res,
      );
      expect(sessions.issue).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ native: true }),
        'provider-refresh',
      );
    });
  });

  describe('logout', () => {
    it('revokes the session named by the refresh cookie', async () => {
      await controller.logoutSession(
        req({ cookies: { mf_refresh: 'our-refresh' } }),
        res,
      );
      expect(sessions.revokeByRefreshHash).toHaveBeenCalledWith(
        'hash:our-refresh',
        UserSessionRevokedReason.USER_LOGOUT,
      );
    });

    it('revokes the session an installed app names by its refresh token', async () => {
      // The app has no cookie, so before this its sign-out revoked nothing.
      await controller.logoutSession(
        req({
          headers: { origin: 'https://localhost' },
          body: { refreshToken: 'app-refresh' },
        }),
        res,
      );
      expect(sessions.revokeByRefreshHash).toHaveBeenCalledWith(
        'hash:app-refresh',
        UserSessionRevokedReason.USER_LOGOUT,
      );
    });

    it('ignores a body token from anything but the app origin', async () => {
      await controller.logoutSession(
        req({
          headers: { origin: 'https://evil.example' },
          body: { refreshToken: 'stolen' },
        }),
        res,
      );
      expect(sessions.revokeByRefreshHash).not.toHaveBeenCalled();
    });

    it('clears every session cookie', async () => {
      await controller.logoutSession(
        req({ cookies: { mf_refresh: 'our-refresh' } }),
        res,
      );
      const cleared = cookiesClearedOn(res);
      expect(cleared).toEqual(
        expect.arrayContaining([
          'mf_access',
          'mf_refresh',
          'mf_sid',
          'mf_csrf',
        ]),
      );
    });

    it('works with a dead access token — which is when people sign out', async () => {
      // Behind JwtGuard this answered 401, so the row stayed live and the
      // cookies stayed in the browser. The next reload signed the user back in.
      await expect(
        controller.logoutSession(
          req({ cookies: { mf_refresh: 'our-refresh' } }),
          res,
        ),
      ).resolves.toEqual({ success: true });
    });

    it('clears the cookies even when there is no session left to revoke', async () => {
      await controller.logoutSession(req(), res);
      expect(sessions.revokeByRefreshHash).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('still refuses a cross-site forgery', async () => {
      await expect(
        controller.logoutSession(
          req({
            cookies: { mf_refresh: 'our-refresh', mf_csrf: 'secret' },
            headers: { 'x-csrf-token': 'guess' },
          }),
          res,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(sessions.revokeByRefreshHash).not.toHaveBeenCalled();
    });

    it('answers 403, not a 500, for a multibyte CSRF header of the same character count', async () => {
      // 6 UTF-16 units each, but 6 vs 18 bytes: `timingSafeEqual` on the raw
      // Buffers used to throw a RangeError here.
      await expect(
        controller.logoutSession(
          req({
            cookies: { mf_refresh: 'our-refresh', mf_csrf: 'secret' },
            headers: { 'x-csrf-token': '€€€€€€' },
          }),
          res,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(sessions.revokeByRefreshHash).not.toHaveBeenCalled();
    });

    it('accepts the matching double-submit token', async () => {
      await expect(
        controller.logoutSession(
          req({
            cookies: { mf_refresh: 'our-refresh', mf_csrf: 'secret' },
            headers: { 'x-csrf-token': 'secret' },
          }),
          res,
        ),
      ).resolves.toEqual({ success: true });
    });
  });

  describe('the boot probe', () => {
    it('answers with the profile and the CSRF token, and no credential', async () => {
      const body = await controller.currentSession(
        { id: 'u1', email: 'a@b.c', user_metadata: {}, token: 't' },
        req({ cookies: { mf_sid: 's1', mf_csrf: 'secret' } }),
      );
      expect(body.user).toEqual({ id: 'u1', username: 'a' });
      expect(body.sessionId).toBe('s1');
      expect(body.csrfToken).toBe('secret');
      expect(JSON.stringify(body)).not.toContain('provider-refresh');
    });
  });
});
