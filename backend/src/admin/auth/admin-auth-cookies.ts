import * as crypto from 'crypto';
import type { Response } from 'express';
import { config } from '../../config';

export interface IssuedAdminSessionCookies {
  /**
   * The CSRF token that was just written to `admin_csrf`.
   *
   * Returned so the handler can put it in the response body. That is not a
   * convenience — it is the fix for the portal's "CSRF validation failed"
   * errors. The double-submit pattern requires the frontend to echo the cookie
   * in a header, and it read that cookie with `document.cookie`, which only
   * works when the app and the API share a site. They do on localhost (cookies
   * ignore ports) and they do NOT in production, where the app is on Vercel and
   * the API on its own domain. The header therefore went out empty and every
   * mutation behind `AdminJwtGuard` was refused, while the unguarded auth
   * routes kept working.
   *
   * Handing the token back in the body is no weaker than the cookie read it
   * replaces: the cookie stays the server's comparison anchor, and the
   * same-origin policy stops a cross-site page reading a response body exactly
   * as it stops it reading a cookie.
   */
  csrfToken: string;
}

/**
 * Cookie attributes, entirely from configuration.
 *
 * The same code issues host-only insecure cookies in local development and
 * domain-scoped Secure cookies in production, without a branch.
 */
function cookieBase() {
  const { domain, secure, sameSite, path } = config.auth.cookie;
  return { domain, secure, sameSite, path } as const;
}

/**
 * Writes the three admin session cookies and returns the CSRF token.
 *
 * Extracted from the controller so it can be tested without dragging
 * `AdminAuthService` — and through it the mailer, `sanitize-html` and `otplib`
 * — into the test's module graph, none of which parse under the project's Jest
 * transform. The behaviour worth pinning down (the body token equals the cookie
 * token; a refresh rotates it; the session cookies stay HttpOnly and the CSRF
 * one does not) all lives here.
 */
export function issueAdminSessionCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): IssuedAdminSessionCookies {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const { accessMaxAgeMs, refreshMaxAgeMs } = config.auth.cookie;
  const base = cookieBase();

  res.cookie('admin_access', accessToken, {
    ...base,
    httpOnly: true,
    maxAge: accessMaxAgeMs,
  });

  res.cookie('admin_refresh', refreshToken, {
    ...base,
    httpOnly: true,
    maxAge: refreshMaxAgeMs,
  });

  res.cookie('admin_csrf', csrfToken, {
    // Deliberately readable by scripts. Making it HttpOnly would look like a
    // hardening win and would break the same-site and local-development paths
    // that still read it directly. The token is not a credential on its own —
    // it is worthless without the HttpOnly session cookie beside it.
    httpOnly: false,
    ...base,
    maxAge: accessMaxAgeMs,
  });

  return { csrfToken };
}

export function clearAdminSessionCookies(res: Response): void {
  const base = cookieBase();
  res.clearCookie('admin_access', { ...base, httpOnly: true });
  res.clearCookie('admin_refresh', { ...base, httpOnly: true });
  res.clearCookie('admin_csrf', { ...base });
}
