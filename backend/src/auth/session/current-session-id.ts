import type { Request } from 'express';
import {
  readCookie,
  USER_SESSION_ID_COOKIE,
  USER_SESSION_ID_HEADER,
} from './user-session-cookies';

/**
 * The session this request is coming from, or null.
 *
 * Web: the `mf_sid` cookie, which wins whenever present (a cookie session
 * cannot be pointed at another id by adding a header). Installed app: no
 * cookie, so it names its session in `x-session-id` beside a bearer token.
 * On guarded routes JwtGuard has already resolved that id and matched it to
 * the token's own user, so it is the caller's own session by the time it is
 * read here. Do not call this on unguarded routes and trust the result.
 */
export function currentSessionId(req: Request): string | null {
  const cookie = readCookie(req, USER_SESSION_ID_COOKIE);
  if (cookie) return cookie;
  const header = req.headers?.[USER_SESSION_ID_HEADER];
  return typeof header === 'string' && header.trim() ? header.trim() : null;
}
