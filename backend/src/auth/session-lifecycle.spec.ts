jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { UserSessionRevokedReason } from '@prisma/client';
import type { AuthService } from './auth.service';
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
  let authService: { login: jest.Mock; syncProfile: jest.Mock };
  let sessions: {
    issue: jest.Mock;
    hashRefreshToken: jest.Mock;
    revokeByRefreshHash: jest.Mock;
  };
  let res: MockResponse;

  const cookiesSet = () => cookiesSetOn(res);

  const makeController = (
    emailService: object = {
      sendNewLoginEmail: jest.fn().mockResolvedValue(undefined),
    },
  ) =>
    new AuthController(
      authService as unknown as AuthService,
      emailService as EmailService,
      {
        consume: jest.fn().mockResolvedValue({ allowed: true }),
        penalize: jest.fn().mockResolvedValue(undefined),
      } as unknown as RateLimitService,
      sessions as unknown as UserSessionService,
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

    it('provisions the profile before creating the session row that points at it', async () => {
      // Adoption is a brand-new account's first request, so its User row may
      // not exist yet; the session insert would fail on the foreign key.
      await controller.adoptSession(
        { refreshToken: 'provider-refresh' },
        user,
        req(),
        res,
      );
      expect(authService.syncProfile.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.issue.mock.invocationCallOrder[0],
      );
    });

    it('issues nothing when the profile cannot be provisioned', async () => {
      authService.syncProfile.mockRejectedValueOnce(
        new UnauthorizedException('Email verification required.'),
      );
      await expect(
        controller.adoptSession(
          { refreshToken: 'provider-refresh' },
          user,
          req(),
          res,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.issue).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
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
