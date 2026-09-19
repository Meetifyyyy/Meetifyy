import { SetMetadata } from '@nestjs/common';

export const ALLOW_BEARER_TOKEN_KEY = 'allowBearerToken';

/**
 * Marks a route that may be authenticated by an `Authorization: Bearer` header
 * rather than by the session cookies.
 *
 * Everywhere else, a bearer token is refused, and that is a security control
 * rather than a preference.
 *
 * A Supabase access token is a self-contained JWT: it is valid for its full
 * hour on signature alone, and nothing about it says which device or session it
 * belongs to. The session table is what makes a session revocable — "sign out
 * this device", "sign out everywhere", and the automatic revocation a password
 * change performs — and it can only be consulted for a request that names a
 * session, which is to say a request authenticated by cookie. So a bearer
 * caller skipped the revocation check entirely: a token lifted from a browser
 * kept working for up to an hour after the owner had signed out, changed their
 * password, or revoked that very device, and simply moving the token from the
 * cookie jar to an `Authorization` header was enough to bypass every one of
 * those controls.
 *
 * The exception exists for one flow. `verifyOtp` at the end of signup mints a
 * provider session in the browser, and the two calls that immediately follow —
 * writing the gathered profile, and handing the session to the server in
 * exchange for cookies — happen before any cookie exists. There is nothing to
 * revoke yet either: the session row those calls are on their way to creating
 * is created by the second of them.
 *
 * Adding this decorator to any other route re-opens the bypass for that route.
 */
export const AllowBearerToken = () => SetMetadata(ALLOW_BEARER_TOKEN_KEY, true);
