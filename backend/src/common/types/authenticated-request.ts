import type { Request } from 'express';

/**
 * Typed views of the Express request after a guard has run.
 *
 * These exist because `@Req() req: any` appeared 129 times across the
 * controllers, and every read off it — `req.user.id` most of all — was
 * unchecked. That is the value authorization decisions are made from, so it is
 * the last thing that should be untyped.
 *
 * The shapes mirror exactly what the guards attach; nothing here is aspirational.
 */

/**
 * What `JwtGuard.validateToken()` normalises every token into and assigns to
 * `request.user`. `id` is the application user id, resolved from `sub`, `id` or
 * `user_id` depending on the token's origin.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  /** Absent in Supabase access tokens; resolved separately where needed. */
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  token: string;
}

/** A request that has passed `JwtGuard`. */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * A request behind `OptionalJwtGuard`, where an anonymous caller is allowed
 * through and `user` is therefore genuinely optional.
 */
export interface OptionalAuthRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * A request as a global or pre-auth guard sees it.
 *
 * Global guards run before route guards, so neither `JwtGuard` nor
 * `AdminJwtGuard` may have run yet: both identities are optional. Nothing has
 * validated the body at this point either, so it is `unknown` and every read
 * of it has to narrow first, which the rate-limit guards already do with
 * `typeof … === 'string'`. Cookies come from `cookie-parser`.
 */
export interface GuardRequest extends Request<
  Record<string, string>,
  unknown,
  unknown
> {
  user?: AuthenticatedUser;
  admin?: AdminActor;
  cookies: Record<string, string | undefined>;
}

/**
 * The fields of a not-yet-validated body, or none.
 *
 * A guard runs before any pipe, so the body may be absent, a string, an array
 * or an object. Reading `body?.field` off `any` treated all of those the same
 * way; this does so explicitly, and every value it returns is still `unknown`.
 */
export function requestBody(
  request: { body?: unknown } | null | undefined,
): Record<string, unknown> {
  const body = request?.body;
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * What the realtime gateway attaches to a socket once its handshake is
 * verified (`socket.data`). Every field is absent until then, so every read
 * must handle an unauthenticated socket. Stored in `socket.data`, Socket.IO's
 * typed per-socket store, rather than as ad-hoc properties on the socket:
 * `data` is what `fetchSockets()` carries across a Redis adapter.
 */
export interface SocketIdentity {
  userId?: string;
  userName?: string;
  /** The session the handshake named; revoking it disconnects the socket. */
  sessionId?: string;
  /** Internal conversation ids joined at connect, read back on disconnect. */
  userConvIds?: string[];
}

/** The `SuperAdmin` row `AdminJwtGuard` loads and attaches. */
export interface AdminActor {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  totpEnabled: boolean;
}

/** The live session row `AdminJwtGuard` verifies before allowing the request. */
export interface AdminSessionRef {
  id: string;
  revoked: boolean;
  expiresAt: Date;
  adminId: string;
}

/** A request that has passed `AdminJwtGuard`. */
export interface AdminRequest extends Request {
  admin: AdminActor;
  adminSession: AdminSessionRef;
  /**
   * Parsed by `cookie-parser`. Declared here rather than cast at each read:
   * the admin session, refresh and CSRF tokens all arrive this way, and an
   * `any` cast at every call site is how a typo in a cookie name goes
   * unnoticed until a guard starts refusing everybody.
   */
  cookies: Record<string, string | undefined>;
}
