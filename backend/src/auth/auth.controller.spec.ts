jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { stub } from '../common/testing/stub';
import { ProviderRefreshUnavailableError } from './auth.service';
import type { AuthService } from './auth.service';
import type { EmailService } from '../email/email.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import type { UserSessionService } from './session/user-session.service';
import type { AuthenticatedUser } from '../common/types/authenticated-request';

/** The body revokeAllSessions accepts. */
type RevokeBody = Parameters<AuthController['revokeAllSessions']>[3];

describe('AuthController — Security / Email Notification Spoofing Prevention', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let emailService: {
    sendWelcomeEmail: jest.Mock;
    sendNewLoginEmail: jest.Mock;
    sendPasswordChangedEmail: jest.Mock;
  };
  let rateLimit: { consume: jest.Mock; check: jest.Mock; penalize: jest.Mock };
  let sessions: Record<string, jest.Mock>;

  beforeEach(() => {
    authService = {};
    emailService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendNewLoginEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue(undefined),
    };
    rateLimit = {
      consume: jest.fn().mockResolvedValue({ allowed: true }),
      check: jest.fn().mockResolvedValue({ allowed: true }),
      penalize: jest.fn().mockResolvedValue(undefined),
    };
    sessions = {
      issue: jest.fn().mockResolvedValue({
        sessionId: 's1',
        familyId: 'f1',
        refreshToken: 'r1',
        expiresAt: new Date(Date.now() + 86400000),
      }),
      rotate: jest.fn(),
      hashRefreshToken: jest.fn((t: string) => `hash:${t}`),
      revokeByRefreshHash: jest.fn().mockResolvedValue(undefined),
      revokeOwnedByUser: jest.fn().mockResolvedValue(true),
      revokeAllForUser: jest.fn().mockResolvedValue(2),
      listForUser: jest.fn().mockResolvedValue([]),
      sessionIdForRefreshToken: jest.fn().mockResolvedValue('s1'),
      storeProviderRefresh: jest.fn<
        ReturnType<UserSessionService['storeProviderRefresh']>,
        Parameters<UserSessionService['storeProviderRefresh']>
      >(() => Promise.resolve()),
    };
    controller = new AuthController(
      stub<AuthService>(authService),
      stub<EmailService>(emailService),
      stub<RateLimitService>(rateLimit),
      stub<UserSessionService>(sessions),
    );
  });

  it('allows welcome email to the authenticated caller’s own email', async () => {
    const user = { id: 'user-1', email: 'alice@example.com' };
    await controller.triggerWelcomeEmail(
      { email: 'alice@example.com', name: 'Alice' },
      user,
    );
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
      'alice@example.com',
      'Alice',
    );
  });

  it('rejects triggering welcome email for an arbitrary victim address', async () => {
    const user = { id: 'user-1', email: 'attacker@example.com' };
    await expect(
      controller.triggerWelcomeEmail(
        { email: 'victim@company.com', name: 'Victim' },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('rejects triggering login notification email for another recipient', async () => {
    const user = { id: 'user-1', email: 'attacker@example.com' };
    const req = stub<Request>({ headers: {}, socket: {} });
    await expect(
      controller.triggerLoginEmail(
        { email: 'victim@company.com', name: 'Victim' },
        req,
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendNewLoginEmail).not.toHaveBeenCalled();
  });

  it('refuses a caller with no verified address of its own, even when it supplies one', async () => {
    const req = stub<Request>({ headers: {}, socket: {} });
    for (const email of ['', 'x@meetifyy.user']) {
      const user = { id: 'user-1', email };
      await expect(
        controller.triggerWelcomeEmail(
          { email: 'victim@company.com', name: 'V' },
          user,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.triggerLoginEmail(
          { email: 'victim@company.com', name: 'V' },
          req,
          user,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.triggerPasswordChangedEmail(
          { email: 'victim@company.com' },
          req,
          user,
        ),
      ).rejects.toThrow(ForbiddenException);
    }
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(emailService.sendNewLoginEmail).not.toHaveBeenCalled();
    expect(emailService.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('prints the request address in the login email, never one the caller wrote', async () => {
    const user = { id: 'user-1', email: 'alice@example.com' };
    const req = stub<Request>({
      headers: {},
      ip: '203.0.113.9',
      socket: { remoteAddress: '203.0.113.9' },
    });
    await controller.triggerLoginEmail(
      { email: 'alice@example.com', name: 'Alice', ip: '6.6.6.6' },
      req,
      user,
    );
    const args = emailService.sendNewLoginEmail.mock.calls[0] as unknown[];
    expect(args[args.length - 1]).toBe('203.0.113.9');
    expect(args).not.toContain('6.6.6.6');
  });

  it('rejects triggering password-changed email for another recipient', async () => {
    const user = { id: 'user-1', email: 'attacker@example.com' };
    const req = stub<Request>({ headers: {}, socket: {} });
    await expect(
      controller.triggerPasswordChangedEmail(
        { email: 'victim@company.com', name: 'Victim' },
        req,
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });
});

/**
 * The two password-change paths want opposite things from session revocation.
 *
 * Changing a password in Settings is done by someone at a device they trust:
 * they are ending everyone else's access, and signing them out of the screen
 * they are standing on would be a bug. A reset through the emailed link is the
 * flow used when an account is believed compromised, and the device completing
 * it may be the one at fault — so nothing is spared.
 */
describe('AuthController — session revocation scope', () => {
  let controller: AuthController;
  let sessions: {
    revokeAllForUser: jest.Mock;
    sessionIdForRefreshToken: jest.Mock;
  };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  /**
   * The session is identified by `mf_sid`, not by the refresh cookie: the
   * refresh cookie's path (`/api/auth/session`) does not match
   * `/api/auth/sessions` under RFC 6265, so it is not sent to these routes at
   * all. Deriving the current session from it answered "none" every time,
   * which made "sign out other devices" sign the caller out too.
   */
  const req = (sessionId?: string) =>
    stub<Request>({
      cookies: sessionId ? { mf_sid: sessionId } : {},
      headers: {},
    });

  beforeEach(() => {
    sessions = {
      revokeAllForUser: jest.fn().mockResolvedValue(3),
      sessionIdForRefreshToken: jest.fn().mockResolvedValue('current-session'),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new AuthController(
      stub<AuthService>(),
      stub<EmailService>(),
      stub<RateLimitService>({ consume: jest.fn(), penalize: jest.fn() }),
      stub<UserSessionService>(sessions),
    );
  });

  const user = stub<AuthenticatedUser>({ id: 'u1' });

  it("defaults to sparing the caller's own session", async () => {
    await controller.revokeAllSessions(
      user,
      req('current-session'),
      stub<Response>(res),
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'current-session',
    );
    // Still signed in here, so the cookies stay.
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("spares the caller's session for scope 'others'", async () => {
    await controller.revokeAllSessions(
      user,
      req('current-session'),
      stub<Response>(res),
      {
        scope: 'others',
      },
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'current-session',
    );
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("spares nothing for scope 'all', and clears this browser's cookies", async () => {
    await controller.revokeAllSessions(
      user,
      req('current-session'),
      stub<Response>(res),
      {
        scope: 'all',
      },
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      undefined,
    );
    // Leaving them set would have the client keep presenting a credential the
    // server has already revoked.
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it("does not even look up the current session for scope 'all'", async () => {
    await controller.revokeAllSessions(
      user,
      req('current-session'),
      stub<Response>(res),
      {
        scope: 'all',
      },
    );
    expect(sessions.sessionIdForRefreshToken).not.toHaveBeenCalled();
  });

  it('treats an unrecognised scope as "others", never as "all"', async () => {
    await controller.revokeAllSessions(
      user,
      req('current-session'),
      stub<Response>(res),
      {
        // Deliberately outside the declared union: the body is client input.
        scope: 'everything',
      } as unknown as RevokeBody,
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'current-session',
    );
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  /**
   * The installed app has no session cookie, so it names its session in the
   * `x-session-id` header. Before this, "sign out other devices" from the app
   * revoked every session including its own.
   */
  describe('from the installed app (x-session-id header, no cookie)', () => {
    const nativeReq = (sessionId?: string) =>
      stub<Request>({
        cookies: {},
        headers: sessionId ? { 'x-session-id': sessionId } : {},
      });

    it("spares the caller's own session for scope 'others'", async () => {
      await controller.revokeAllSessions(
        user,
        nativeReq('native-session'),
        stub<Response>(res),
        { scope: 'others' },
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        expect.anything(),
        'native-session',
      );
    });

    it('still spares nothing for scope all', async () => {
      await controller.revokeAllSessions(
        user,
        nativeReq('native-session'),
        stub<Response>(res),
        { scope: 'all' },
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        expect.anything(),
        undefined,
      );
    });

    it('lets a cookie session win over a header naming another id', async () => {
      await controller.revokeAllSessions(
        user,
        stub<Request>({
          cookies: { mf_sid: 'cookie-session' },
          headers: { 'x-session-id': 'someone-elses' },
        }),
        stub<Response>(res),
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        expect.anything(),
        'cookie-session',
      );
    });

    it('ignores an empty or non-string header, and so cannot identify the session', async () => {
      await expect(
        controller.revokeAllSessions(
          user,
          stub<Request>({ cookies: {}, headers: { 'x-session-id': '   ' } }),
          stub<Response>(res),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  it("refuses scope 'others' (400) when the current session cannot be identified", async () => {
    // Revoking anyway would silently sign the caller out of the screen in use.
    sessions.sessionIdForRefreshToken.mockResolvedValue(null);
    await expect(
      controller.revokeAllSessions(user, req(), stub<Response>(res)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("still signs everything out for scope 'all' without an identifiable session", async () => {
    const result = await controller.revokeAllSessions(
      user,
      req(),
      stub<Response>(res),
      { scope: 'all' },
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      undefined,
    );
    expect(result.revoked).toBe(3);
  });
});

/**
 * Password change, and the revocation that has to come with it.
 *
 * This moved server-side because the client version stopped working: it called
 * `supabase.auth.updateUser`, and once the session left localStorage the
 * provider's client had nothing in memory to update with after a reload — so
 * the change failed on a form that had already reported success.
 *
 * Revoking other sessions is part of the same operation rather than a
 * follow-up the client makes, because a follow-up can be skipped or fail on
 * its own and leave a changed password with somebody else's session still live.
 */
describe('AuthController — change password', () => {
  let controller: AuthController;
  let authService: { changePassword: jest.Mock };
  let sessions: { revokeAllForUser: jest.Mock };

  const user = stub<AuthenticatedUser>({ id: 'u1' });
  const req = (sid = 'this-device') =>
    stub<Request>({
      cookies: { mf_sid: sid },
      headers: {},
    });

  beforeEach(() => {
    authService = {
      changePassword: jest.fn().mockResolvedValue({ success: true }),
    };
    sessions = { revokeAllForUser: jest.fn().mockResolvedValue(2) };
    controller = new AuthController(
      stub<AuthService>(authService),
      stub<EmailService>(),
      stub<RateLimitService>({ consume: jest.fn(), penalize: jest.fn() }),
      stub<UserSessionService>(sessions),
    );
  });

  it('changes the password and signs out the other devices', async () => {
    const result = await controller.changePassword(
      { currentPassword: 'old-one', newPassword: 'a-new-one' },
      user,
      req(),
    );

    expect(authService.changePassword).toHaveBeenCalledWith(
      user,
      'old-one',
      'a-new-one',
    );
    expect(result).toEqual({ success: true, otherSessionsRevoked: 2 });
  });

  it('spares the device the change was made from', async () => {
    await controller.changePassword(
      { currentPassword: 'old-one', newPassword: 'a-new-one' },
      user,
      req('this-device'),
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'this-device',
    );
  });

  it('does not revoke anything when the change itself fails', async () => {
    authService.changePassword.mockRejectedValue(new Error('wrong password'));

    await expect(
      controller.changePassword(
        { currentPassword: 'wrong', newPassword: 'a-new-one' },
        user,
        req(),
      ),
    ).rejects.toThrow('wrong password');

    // Signing devices out on a failed attempt would let anyone holding a
    // session log everybody else out by guessing wrongly.
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});

describe('AuthController — refresh can carry the profile', () => {
  let controller: AuthController;
  let authService: {
    syncProfile: jest.Mock<
      ReturnType<AuthService['syncProfile']>,
      Parameters<AuthService['syncProfile']>
    >;
    refreshProviderSession: jest.Mock<
      ReturnType<AuthService['refreshProviderSession']>,
      Parameters<AuthService['refreshProviderSession']>
    >;
  };
  let sessions: {
    rotate: jest.Mock<
      ReturnType<UserSessionService['rotate']>,
      Parameters<UserSessionService['rotate']>
    >;
    storeProviderRefresh: jest.Mock<
      ReturnType<UserSessionService['storeProviderRefresh']>,
      Parameters<UserSessionService['storeProviderRefresh']>
    >;
    undoRotation: jest.Mock<
      ReturnType<UserSessionService['undoRotation']>,
      Parameters<UserSessionService['undoRotation']>
    >;
  };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  const profile = stub<Awaited<ReturnType<AuthService['syncProfile']>>>({
    id: 'u1',
    username: 'ada',
    meta: { postBookmarkIds: [], activityBookmarkIds: [], unreadNotifCount: 0 },
  });
  const req = (body?: Record<string, unknown>) =>
    stub<Request>({
      cookies: { mf_refresh: 'our-refresh' },
      headers: {},
      socket: {},
      body,
    });

  beforeEach(() => {
    authService = {
      syncProfile: jest.fn<
        ReturnType<AuthService['syncProfile']>,
        Parameters<AuthService['syncProfile']>
      >(() => Promise.resolve(profile)),
      refreshProviderSession: jest
        .fn<
          ReturnType<AuthService['refreshProviderSession']>,
          Parameters<AuthService['refreshProviderSession']>
        >()
        .mockResolvedValue({
          access_token: 'access',
          refresh_token: 'provider-next',
          expires_in: 3600,
        }),
    };
    sessions = {
      rotate: jest
        .fn<
          ReturnType<UserSessionService['rotate']>,
          Parameters<UserSessionService['rotate']>
        >()
        .mockResolvedValue({
          ok: true,
          userId: 'u1',
          session: {
            sessionId: 's2',
            familyId: 'f1',
            refreshToken: 'our-next',
            expiresAt: new Date(Date.now() + 86_400_000),
            providerRefreshToken: 'provider-refresh',
            previousSessionId: 's1',
          },
        }),
      storeProviderRefresh: jest.fn<
        ReturnType<UserSessionService['storeProviderRefresh']>,
        Parameters<UserSessionService['storeProviderRefresh']>
      >(() => Promise.resolve()),
      undoRotation: jest.fn<
        ReturnType<UserSessionService['undoRotation']>,
        Parameters<UserSessionService['undoRotation']>
      >(() => Promise.resolve(true)),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new AuthController(
      stub<AuthService>(authService),
      stub<EmailService>(),
      stub<RateLimitService>({ consume: jest.fn(), penalize: jest.fn() }),
      stub<UserSessionService>(sessions),
    );
  });

  it('returns the profile when asked, loaded alongside the provider call', async () => {
    // The provider call is held open: the profile must already have been
    // requested by then, or the two are serial again.
    let release: () => void = () => undefined;
    authService.refreshProviderSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ access_token: 'a', refresh_token: 'p', expires_in: 60 });
        }),
    );
    const pending = controller.refreshSession(
      req({ includeProfile: true }),
      stub<Response>(res),
    );
    await new Promise((r) => setImmediate(r));
    expect(authService.syncProfile).toHaveBeenCalledWith({ id: 'u1' }, 's2');
    release();

    const body = await pending;
    expect(body).toMatchObject({ user: profile, meta: profile.meta });
  });

  it('leaves the ordinary renewal exactly as it was', async () => {
    const body = await controller.refreshSession(req(), stub<Response>(res));
    expect(authService.syncProfile).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('user');
  });

  it('omits the profile, rather than failing the renewal, when it cannot be loaded', async () => {
    authService.syncProfile.mockRejectedValue(new Error('db down'));
    const body = await controller.refreshSession(
      req({ includeProfile: true }),
      stub<Response>(res),
    );
    expect(body).not.toHaveProperty('user');
    expect(body).toHaveProperty('sessionId', 's2');
  });

  describe('when the identity provider is unavailable (not a verdict on the token)', () => {
    beforeEach(() => {
      authService.refreshProviderSession.mockRejectedValue(
        new ProviderRefreshUnavailableError(),
      );
    });

    it('answers 503, not 401, so the client keeps the session', async () => {
      await expect(
        controller.refreshSession(req(), stub<Response>(res)),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('keeps the cookies', async () => {
      await controller
        .refreshSession(req(), stub<Response>(res))
        .catch(() => undefined);
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('puts the rotation back so the retry is not judged a replay', async () => {
      await controller
        .refreshSession(req(), stub<Response>(res))
        .catch(() => undefined);
      expect(sessions.undoRotation).toHaveBeenCalledWith('s1', 's2');
      expect(sessions.storeProviderRefresh).not.toHaveBeenCalled();
    });

    it('still answers 503 if the undo itself fails', async () => {
      sessions.undoRotation.mockRejectedValue(new Error('db down'));
      await expect(
        controller.refreshSession(req(), stub<Response>(res)),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('works the same on the native body-refresh path', async () => {
      const nativeReq = stub<Request>({
        cookies: {},
        headers: { origin: 'https://localhost' },
        socket: {},
        body: { refreshToken: 'app-refresh' },
      });
      await expect(
        controller.refreshSession(nativeReq, stub<Response>(res)),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(sessions.undoRotation).toHaveBeenCalledWith('s1', 's2');
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });

  it("keeps today's behaviour for a definitive rejection: clear cookies, 401, no undo", async () => {
    authService.refreshProviderSession.mockResolvedValue(null);
    await expect(
      controller.refreshSession(req(), stub<Response>(res)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.clearCookie).toHaveBeenCalled();
    expect(sessions.undoRotation).not.toHaveBeenCalled();
  });

  it('never hands out a profile when the provider refuses the renewal', async () => {
    authService.refreshProviderSession.mockResolvedValue(null);
    await expect(
      controller.refreshSession(
        req({ includeProfile: true }),
        stub<Response>(res),
      ),
    ).rejects.toThrow('Session expired');
  });
});

describe('AuthController — per-email budget on campus requests', () => {
  const dto = {
    name: 'Ada Lovelace',
    collegeName: 'Example College',
    collegeEmail: ' Ada@Example.EDU ',
    personalEmail: 'ada@gmail.com',
  };

  const build = (allowed: boolean) => {
    const consume = jest.fn().mockResolvedValue({
      allowed,
      remaining: 0,
      limit: 3,
      resetSeconds: 60,
      policy: 'auth.collegerequest.email',
    });
    const createCollegeRequest = jest.fn().mockResolvedValue({ id: 'r1' });
    const controller = new AuthController(
      stub<AuthService>({ createCollegeRequest }),
      stub<EmailService>(),
      stub<RateLimitService>({ consume, penalize: jest.fn() }),
      stub<UserSessionService>(),
    );
    return { controller, consume, createCollegeRequest };
  };

  it('charges the budget against the normalised college email', async () => {
    const { controller, consume } = build(true);
    await controller.requestCollege(dto, stub<Request>({ headers: {} }));
    expect(consume).toHaveBeenCalledWith(
      'auth.collegerequest.email',
      'ada@example.edu',
    );
  });

  it('answers 429 and files nothing once the address is over budget', async () => {
    const { controller, createCollegeRequest } = build(false);
    await expect(
      controller.requestCollege(dto, stub<Request>({ headers: {} })),
    ).rejects.toMatchObject({ status: 429 });
    expect(createCollegeRequest).not.toHaveBeenCalled();
  });
});

describe('AuthController — failed logins share one budget per account', () => {
  const build = (canonical: string | null | Error) => {
    const penalize = jest.fn().mockResolvedValue(undefined);
    const login = jest.fn().mockRejectedValue(new UnauthorizedException('bad'));
    const canonicalLoginEmail = jest.fn(() =>
      canonical instanceof Error
        ? Promise.reject(canonical)
        : Promise.resolve(canonical),
    );
    const controller = new AuthController(
      stub<AuthService>({ login, canonicalLoginEmail }),
      stub<EmailService>(),
      stub<RateLimitService>({ consume: jest.fn(), penalize }),
      stub<UserSessionService>(),
    );
    return { controller, penalize, login };
  };
  const reqFor = (identifier: string) =>
    stub<Request>({ headers: {}, body: { identifier } });

  it('also charges the email a username resolves to', async () => {
    const { controller, penalize } = build('ada@example.edu');
    await expect(
      controller.login(
        { identifier: 'ada', password: 'x' },
        reqFor('ada'),
        stub<Response>({}),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(penalize).toHaveBeenCalledWith('auth.login.account', 'ada');
    expect(penalize).toHaveBeenCalledWith(
      'auth.login.account',
      'ada@example.edu',
    );
  });

  it('does not double-charge when the identifier already is the email', async () => {
    const { controller, penalize } = build('ada@example.edu');
    await expect(
      controller.login(
        { identifier: 'Ada@Example.edu', password: 'x' },
        reqFor('Ada@Example.edu'),
        stub<Response>({}),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(penalize).toHaveBeenCalledTimes(1);
  });

  it('still reports the original failure when the canonical lookup breaks', async () => {
    const { controller } = build(new Error('db down'));
    await expect(
      controller.login(
        { identifier: 'ada', password: 'x' },
        reqFor('ada'),
        stub<Response>({}),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthController — finalising a password reset', () => {
  const user = {
    id: 'u1',
    email: 'ada@example.edu',
    user_metadata: { displayName: 'Ada' },
    token: 'recovery-token',
  };
  const req = stub<Request>({
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126' },
    ip: '203.0.113.5',
    socket: {},
  });

  const build = (
    sendPasswordChangedEmail = jest
      .fn<Promise<void>, [string, string, string, string, string]>()
      .mockResolvedValue(undefined),
  ) => {
    const revokeAllForUser = jest.fn().mockResolvedValue(4);
    const controller = new AuthController(
      stub<AuthService>(),
      stub<EmailService>({ sendPasswordChangedEmail }),
      stub<RateLimitService>(),
      stub<UserSessionService>({ revokeAllForUser }),
    );
    return { controller, revokeAllForUser, sendPasswordChangedEmail };
  };

  it('revokes every session, sparing none, with the password-changed reason', async () => {
    const { controller, revokeAllForUser } = build();
    const out = await controller.finalizePasswordReset(user, req, {});
    expect(revokeAllForUser).toHaveBeenCalledTimes(1);
    expect(revokeAllForUser).toHaveBeenCalledWith('u1', 'PASSWORD_CHANGED');
    expect(out).toEqual({ success: true, revoked: 4, emailSent: true });
  });

  it("emails the token's verified address, never one from the request", async () => {
    const { controller, sendPasswordChangedEmail } = build();
    // The DTO has no recipient field at all; even a smuggled one is ignored.
    await controller.finalizePasswordReset(user, req, {
      email: 'victim@x.com',
    } as never);
    expect(sendPasswordChangedEmail.mock.calls[0][0]).toBe('ada@example.edu');
  });

  it('keeps the revocation when the email cannot be sent', async () => {
    const { controller, revokeAllForUser } = build(
      jest
        .fn<Promise<void>, [string, string, string, string, string]>()
        .mockRejectedValue(new Error('smtp down')),
    );
    const out = await controller.finalizePasswordReset(user, req, {});
    expect(revokeAllForUser).toHaveBeenCalled();
    expect(out).toMatchObject({ success: true, emailSent: false });
  });
});
