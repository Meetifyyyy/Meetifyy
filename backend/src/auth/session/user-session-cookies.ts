import * as crypto from 'crypto';
import type { Response } from 'express';
import { config } from '../../config';

/**
 * The user session cookies.
 *
 * `mf_` rather than the admin prefix so the two never collide on a shared
 * domain, and so a browser holding both keeps them apart.
 */
export const USER_ACCESS_COOKIE = 'mf_access';
export const USER_REFRESH_COOKIE = 'mf_refresh';
export const USER_CSRF_COOKIE = 'mf_csrf';

export interface IssuedUserSessionCookies {
  /**
   * The CSRF token just written to `mf_csrf`, returned for the response body.
   *
   * Same reasoning as the admin flow: the app and the API are not same-site in
   * production, so the frontend cannot read the cookie with `document.cookie`
   * and echo it. Handing it back in the body is no weaker — the cookie remains
   * the server's comparison anchor, and same-origin policy protects a response
   * body exactly as it protects a cookie.
   */
  csrfToken: string;
}

function cookieBase() {
  const { domain, secure, sameSite, path } = config.auth.cookie;
  return { domain, secure, sameSite, path } as const;
}

/**
 * Writes the session cookies for a signed-in user.
 *
 * The access and refresh tokens are HttpOnly, which is the entire point of this
 * module: they used to be handed to the browser in a response body and kept in
 * `localStorage`, where any script on the origin could read them, and where
 * nothing could take them back. A script cannot read these.
 *
 * The refresh cookie is additionally scoped to the refresh endpoint's path, so
 * it is not attached to the hundreds of ordinary API calls that have no use for
 * it — the long-lived credential travels as rarely as possible.
 */
export function issueUserSessionCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  accessMaxAgeMs: number,
  refreshMaxAgeMs: number,
): IssuedUserSessionCookies {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const base = cookieBase();

  res.cookie(USER_ACCESS_COOKIE, accessToken, {
    ...base,
    httpOnly: true,
    maxAge: accessMaxAgeMs,
  });

  res.cookie(USER_REFRESH_COOKIE, refreshToken, {
    ...base,
    httpOnly: true,
    path: '/api/auth/session',
    maxAge: refreshMaxAgeMs,
  });

  res.cookie(USER_CSRF_COOKIE, csrfToken, {
    // Readable on purpose. It is not a credential by itself — it is worthless
    // without the HttpOnly cookie beside it, and the client has to be able to
    // echo it back in a header for the double-submit check to mean anything.
    httpOnly: false,
    ...base,
    maxAge: refreshMaxAgeMs,
  });

  return { csrfToken };
}

/**
 * Clears all three.
 *
 * The attributes have to match the ones they were set with or the browser keeps
 * the original cookie — which would leave a "signed out" user still holding a
 * live credential. That is why the refresh cookie repeats its narrower path.
 */
export function clearUserSessionCookies(res: Response): void {
  const base = cookieBase();
  res.clearCookie(USER_ACCESS_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(USER_REFRESH_COOKIE, {
    ...base,
    httpOnly: true,
    path: '/api/auth/session',
  });
  res.clearCookie(USER_CSRF_COOKIE, { ...base, httpOnly: false });
}
