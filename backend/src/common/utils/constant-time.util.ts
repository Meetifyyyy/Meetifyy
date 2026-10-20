import { timingSafeEqual } from 'crypto';

/**
 * Compares two strings without leaking their contents through timing.
 *
 * The comparison is over BYTES, not UTF-16 code units: `timingSafeEqual` throws
 * a RangeError when its buffers differ in length, and a string with multibyte
 * characters can have the same `.length` as another yet encode to a different
 * byte count. The length check therefore sits outside the timing-safe path and
 * is made on the encoded buffers. A token's length is not the secret.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
