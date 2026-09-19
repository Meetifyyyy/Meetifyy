jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str) => str),
  sanitizePlainText: jest.fn((str) => str),
  htmlToPlainText: jest.fn((str) => str),
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { UserSessionRevokedReason } from '@prisma/client';

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
  let authService: any;
  let sessions: any;
  let res: any;

  const cookiesSet = () =>
    Object.fromEntries(res.cookie.mock.calls.map((c: any[]) => [c[0], c[1]]));

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
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new AuthController(
      authService,
      { sendNewLoginEmail: jest.fn().mockResolvedValue(undefined) } as any,
      {
        consume: jest.fn().mockResolvedValue({ allowed: true }),
        penalize: jest.fn().mockResolvedValue(undefined),
      } as any,
      sessions,
    );
  });

  const req = (extra: any = {}) => ({
    headers: { 'user-agent': 'jest' },
    cookies: {},
    ...extra,
  });

  describe('login', () => {
    it('returns no provider token of any kind to the browser', async () => {
      const body = await controller.login(
        { identifier: 'a', password: 'p' } as any,
        req() as any,
        res,
      );

      const serialised = JSON.stringify(body);
      expect(serialised).not.toContain('provider-refresh');
      expect(serialised).not.toContain('provider-access');
      expect((body as any).session).toBeUndefined();
    });

    it('keeps the provider refresh token server-side, sealed into the session', async () => {
      await controller.login(
        { identifier: 'a', password: 'p' } as any,
        req() as any,
        res,
      );
      expect(sessions.issue).toHaveBeenCalledWith(
        'u1',
        expect.anything(),
        'provider-refresh',
      );
    });

    it('sets the access token as an HttpOnly cookie, not a response field', async () => {
      await controller.login(
        { identifier: 'a', password: 'p' } as any,
        req() as any,
        res,
      );
      const set = cookiesSet();
      expect(set.mf_access).toBe('provider-access');
      expect(set.mf_refresh).toBe('our-refresh');
      expect(set.mf_sid).toBe('s1');
    });

    it('returns the full profile, so the client needs no second request', async () => {
      // The client used to sign in and then ask who it had just signed in as,
      // treating a failure of that second call as a failed login. One response
      // answers both questions and leaves no window to lose.
      const body: any = await controller.login(
        { identifier: 'a', password: 'p' } as any,
        req() as any,
        res,
      );
      expect(body.user).toEqual({ id: 'u1', username: 'a' });
      expect(authService.syncProfile).toHaveBeenCalled();
    });

    it('still signs the user in when the profile read fails', async () => {
      // The credentials were accepted and the session exists by then, so an
      // enrichment failure must not become a failed sign-in.
      authService.syncProfile.mockRejectedValueOnce(new Error('db blip'));

      const body: any = await controller.login(
        { identifier: 'a', password: 'p' } as any,
        req() as any,
        res,
      );

      expect(body.user.id).toBe('u1');
      expect(body.csrfToken).toEqual(expect.any(String));
      expect(cookiesSet().mf_access).toBe('provider-access');
    });

    it('hands back the CSRF token so a page that cannot read the cookie can still echo it', async () => {
      const body: any = await controller.login(
        { identifier: 'a', password: 'p' } as any,
        req() as any,
        res,
      );
      expect(body.csrfToken).toEqual(expect.any(String));
      expect(body.csrfToken).toBe(cookiesSet().mf_csrf);
    });
  });

  describe('logout', () => {
    it('revokes the session named by the refresh cookie', async () => {
      await controller.logoutSession(
        req({ cookies: { mf_refresh: 'our-refresh' } }) as any,
        res,
      );
      expect(sessions.revokeByRefreshHash).toHaveBeenCalledWith(
        'hash:our-refresh',
        UserSessionRevokedReason.USER_LOGOUT,
      );
    });

    it('clears every session cookie', async () => {
      await controller.logoutSession(
        req({ cookies: { mf_refresh: 'our-refresh' } }) as any,
        res,
      );
      const cleared = res.clearCookie.mock.calls.map((c: any[]) => c[0]);
      expect(cleared).toEqual(
        expect.arrayContaining(['mf_access', 'mf_refresh', 'mf_sid', 'mf_csrf']),
      );
    });

    it('works with a dead access token — which is when people sign out', async () => {
      // Behind JwtGuard this answered 401, so the row stayed live and the
      // cookies stayed in the browser. The next reload signed the user back in.
      await expect(
        controller.logoutSession(
          req({ cookies: { mf_refresh: 'our-refresh' } }) as any,
          res,
        ),
      ).resolves.toEqual({ success: true });
    });

    it('clears the cookies even when there is no session left to revoke', async () => {
      await controller.logoutSession(req() as any, res);
      expect(sessions.revokeByRefreshHash).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('still refuses a cross-site forgery', async () => {
      await expect(
        controller.logoutSession(
          req({
            cookies: { mf_refresh: 'our-refresh', mf_csrf: 'secret' },
            headers: { 'x-csrf-token': 'guess' },
          }) as any,
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
          }) as any,
          res,
        ),
      ).resolves.toEqual({ success: true });
    });
  });

  describe('the boot probe', () => {
    it('answers with the profile and the CSRF token, and no credential', async () => {
      const body: any = await controller.currentSession(
        { id: 'u1', email: 'a@b.c', token: 't' } as any,
        req({ cookies: { mf_sid: 's1', mf_csrf: 'secret' } }) as any,
      );
      expect(body.user).toEqual({ id: 'u1', username: 'a' });
      expect(body.sessionId).toBe('s1');
      expect(body.csrfToken).toBe('secret');
      expect(JSON.stringify(body)).not.toContain('provider-refresh');
    });
  });
});
