import type { JwtPayload } from 'jsonwebtoken';

/**
 * Reading claims out of a token `jsonwebtoken` has already verified.
 *
 * `jwt.verify` returns `string | JwtPayload`, and `JwtPayload` has an `any`
 * index signature, so `payload.sessionId` compiles whatever the token held. A
 * token signed by this server always has the claims it was issued with, but a
 * missing or mistyped claim used to reach Prisma or `crypto` as `undefined` and
 * surface as a 500. These make that a clean refusal instead.
 */

/** The object payload of a verified token, or null for a bare-string payload. */
export function payloadObject(payload: string | JwtPayload): JwtPayload | null {
  return typeof payload === 'string' ? null : payload;
}

/** A claim that is a non-empty string, or undefined. */
export function stringClaim(
  payload: JwtPayload,
  key: string,
): string | undefined {
  const value: unknown = payload[key];
  return typeof value === 'string' && value ? value : undefined;
}
