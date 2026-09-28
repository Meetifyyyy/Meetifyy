import type { Algorithm } from 'jsonwebtoken';

/**
 * The one algorithm admin tokens (pending, access, refresh) are signed and
 * verified with.
 *
 * jsonwebtoken already limits a string secret to the HMAC family, so leaving
 * `algorithms` unset was not an algorithm-confusion hole. Pinning it anyway
 * makes signing and every verifier agree by construction: the rate limiter
 * already verified `admin_access` as HS256 only, while AdminJwtGuard would
 * have accepted HS384/HS512.
 */
export const ADMIN_TOKEN_ALGORITHM: Algorithm = 'HS256';
