jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str) => str),
  sanitizePlainText: jest.fn((str) => str),
  htmlToPlainText: jest.fn((str) => str),
}));

import { ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController — Security / Email Notification Spoofing Prevention', () => {
  let controller: AuthController;
  let authService: any;
  let emailService: any;
  let rateLimit: any;
  let sessions: any;

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
      storeProviderRefresh: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(
      authService,
      emailService,
      rateLimit,
      sessions,
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
    const req: any = { headers: {}, socket: {} };
    await expect(
      controller.triggerLoginEmail(
        { email: 'victim@company.com', name: 'Victim' },
        req,
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendNewLoginEmail).not.toHaveBeenCalled();
  });

  it('rejects triggering password-changed email for another recipient', async () => {
    const user = { id: 'user-1', email: 'attacker@example.com' };
    const req: any = { headers: {}, socket: {} };
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
  let controller: any;
  let sessions: any;
  let res: any;

  /**
   * The session is identified by `mf_sid`, not by the refresh cookie: the
   * refresh cookie's path (`/api/auth/session`) does not match
   * `/api/auth/sessions` under RFC 6265, so it is not sent to these routes at
   * all. Deriving the current session from it answered "none" every time,
   * which made "sign out other devices" sign the caller out too.
   */
  const req = (sessionId?: string) => ({
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
      {} as any,
      {} as any,
      { consume: jest.fn(), penalize: jest.fn() } as any,
      sessions,
    );
  });

  const user = { id: 'u1' } as any;

  it("defaults to sparing the caller's own session", async () => {
    await controller.revokeAllSessions(user, req('current-session') as any, res);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'current-session',
    );
    // Still signed in here, so the cookies stay.
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("spares the caller's session for scope 'others'", async () => {
    await controller.revokeAllSessions(user, req('current-session') as any, res, {
      scope: 'others',
    });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'current-session',
    );
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("spares nothing for scope 'all', and clears this browser's cookies", async () => {
    await controller.revokeAllSessions(user, req('current-session') as any, res, {
      scope: 'all',
    });
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
    await controller.revokeAllSessions(user, req('current-session') as any, res, {
      scope: 'all',
    });
    expect(sessions.sessionIdForRefreshToken).not.toHaveBeenCalled();
  });

  it('treats an unrecognised scope as "others", never as "all"', async () => {
    await controller.revokeAllSessions(user, req('current-session') as any, res, {
      scope: 'everything' as any,
    });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'current-session',
    );
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('still works when there is no refresh cookie to identify', async () => {
    sessions.sessionIdForRefreshToken.mockResolvedValue(null);
    const result = await controller.revokeAllSessions(user, req() as any, res);
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
  let controller: any;
  let authService: any;
  let sessions: any;

  const user = { id: 'u1' } as any;
  const req = (sid = 'this-device') => ({ cookies: { mf_sid: sid }, headers: {} });

  beforeEach(() => {
    authService = { changePassword: jest.fn().mockResolvedValue({ success: true }) };
    sessions = { revokeAllForUser: jest.fn().mockResolvedValue(2) };
    controller = new AuthController(
      authService,
      {} as any,
      { consume: jest.fn(), penalize: jest.fn() } as any,
      sessions,
    );
  });

  it('changes the password and signs out the other devices', async () => {
    const result = await controller.changePassword(
      { currentPassword: 'old-one', newPassword: 'a-new-one' },
      user,
      req() as any,
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
      req('this-device') as any,
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
        req() as any,
      ),
    ).rejects.toThrow('wrong password');

    // Signing devices out on a failed attempt would let anyone holding a
    // session log everybody else out by guessing wrongly.
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});
