/**
 * Which routes need what, before a request is made.
 *
 * Two questions the transport asks of every call, and neither depends on the
 * device: may this path be called without a session, and does this path
 * authenticate with a bearer token rather than the cookie. The answers are
 * properties of the API, so every client that talks to it needs the same ones —
 * which is why they live here rather than in any one client's transport.
 *
 * The comments on PUBLIC_PATHS are load-bearing. Each entry is there because
 * its absence broke something specific for a signed-out visitor, and the reason
 * is recorded so the next person does not tidy the list. They are reproduced
 * verbatim from the file this was lifted out of.
 *
 * Note on BEARER_PATHS: this is a path list with no method, while the server
 * allows a bearer token on `PATCH /api/users/me` only (`@AllowBearerToken` in
 * users.controller.ts) — a GET to the same path is cookie-only. Sending the
 * header on the GET is harmless, since the server ignores it in favour of the
 * cookie, but the two are not the same shape. Left as-is deliberately: this is
 * a move, not a behaviour change.
 */

export const PUBLIC_PATHS = [
  // Signup and its confirmation-code resend. Both are made before the account
  // has a session by definition — that is the whole point of the step — and
  // `/api/auth/signup` also covers `/api/auth/signup/resend` by prefix.
  '/api/auth/signup',
  '/api/auth/login',
  '/api/health',
  // These are called during signup before the user has a session
  '/api/auth/check-username',
  '/api/auth/check-email',
  // Forgot password. The person asking is by definition signed out, so without
  // this entry `request` refuses the call before a byte reaches the network and
  // the reset screen fails for everyone who actually needs it.
  '/api/auth/request-password-reset',
  '/api/auth/account-exists',
  // The help centre and the support-request form. These have to work for a
  // signed-out visitor — someone locked out of their account is exactly the
  // person who needs them — so without this entry `request` rejects every call
  // with "Missing access token" before a single byte reaches the network, and
  // the public Help & Support page can never load its content.
  '/api/support',
  // Public reference data: signup needs the catalog before a session exists,
  // and colleges are required for the college-selection step of signup.
  // The backend controller marks both as deliberately unauthenticated.
  '/api/academics/catalog',
  '/api/academics/colleges',
  // The public view of a shared post. A visitor arriving from a link on
  // WhatsApp has no session by definition, and without this entry `request`
  // rejects the call before a byte reaches the network — which presented every
  // valid shared link as "post not found", indistinguishably from a genuinely
  // private one. The server applies the real gate (see
  // backend/src/share/share-preview.service.ts); this list only decides whether
  // the browser is willing to ask.
  '/api/share',
  // The published legal documents. The Terms and Privacy pages are linked from
  // the landing footer and the signup form, so the reader is signed out by
  // definition — and a user held behind the mandatory-acknowledgement gate has
  // to be able to read the document they are being asked to accept. Without
  // this entry `request` rejects both cases with "Missing access token" before
  // a byte reaches the network, and the page renders its error state.
  //
  // Only the two document routes. `/api/legal/consent` is deliberately NOT
  // here: it is about a specific user and must carry their token.
  '/api/legal/documents',
  // "Bring Meetifyy to your campus" on the landing page. The person asking for
  // their college to be added has, by definition, no account yet — that is the
  // entire point of the form. The server treats this route as public too (see
  // AuthController.requestCollege: rate limiting only, no JwtGuard), so
  // without this entry `request` would refuse the call before a byte reached
  // the network and the form could never work for its actual audience.
  '/api/auth/request-college',
];

/**
 * Paths that authenticate with the bearer token rather than the cookie.
 *
 * Only the handover at the end of signup. `verifyOtp` answers with a provider
 * session and no cookies exist yet, so these two calls are the one place where
 * waiting for the token to be in hand still decides whether the request works.
 */
export const BEARER_PATHS = ['/api/auth/session/adopt', '/api/users/me'];

export function isBearerPath(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return BEARER_PATHS.some((p) => clean === p || clean.startsWith(`${p}?`));
}

export function isPublicPath(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return PUBLIC_PATHS.some(p => clean === p || clean.startsWith(`${p}?`) || clean.startsWith(`${p}/`));
}

/** Methods the server never asks for a CSRF header on. */
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
