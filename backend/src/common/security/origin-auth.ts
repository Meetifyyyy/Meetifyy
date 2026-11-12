import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Proof that a request came through OUR Cloudflare zone.
 *
 * The production origin only accepts Cloudflare's address ranges, but those
 * ranges are shared by every Cloudflare customer: anyone can point their own
 * zone or Worker at the origin's hostname and arrive from an allowed address.
 * A transform rule on the meetifyy.app zone adds this header with a secret
 * value, and the origin refuses a request that lacks it.
 *
 * Off when ORIGIN_AUTH_SECRET is unset, which is every environment whose API
 * is not behind the Cloudflare proxy (local, and development while
 * dev-api.meetifyy.app is DNS-only).
 */
export const ORIGIN_AUTH_HEADER = 'x-origin-auth';

/**
 * Paths answered without the header. `/health` is called by the platform's own
 * probes and by the deploy pipeline, neither of which passes through
 * Cloudflare; it reveals a commit hash and nothing else.
 */
export function isOriginAuthExempt(path: string): boolean {
  const bare = path.split('?')[0].replace(/\/+$/, '');
  return bare === '/health';
}

/** Whether the presented header value proves the request came through our zone. */
export function isOriginAuthorized(
  presented: string | string[] | undefined,
  secret: string,
): boolean {
  if (!secret) return true;
  if (typeof presented !== 'string' || presented.length === 0) return false;
  // Hash both sides so the comparison is constant-time whatever their lengths.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
