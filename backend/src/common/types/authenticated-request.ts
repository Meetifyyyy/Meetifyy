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
