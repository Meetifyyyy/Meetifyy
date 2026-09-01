import { randomBytes } from 'crypto';

/**
 * URL-safe 62-character alphabet (A-Z, a-z, 0-9)
 */
const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generates a cryptographically secure, random, URL-safe public ID for conversations.
 *
 * Default length of 12 characters provides > 71 bits of entropy (62^12 ≈ 3.2 × 10^21 combinations),
 * making collisions virtually impossible while keeping URLs short and aesthetic.
 *
 * @param length Length of generated ID (default: 12)
 * @returns Cryptographically secure public ID string
 */
export function generatePublicId(length = 12): string {
  // Rejection sampling, not `byte % 62`. A byte holds 256 values and 256 is not
  // a multiple of 62, so the modulo maps the first 8 characters of the alphabet
  // to five bytes each and the rest to four - making those characters ~25% more
  // likely and shaving real entropy off every ID. Bytes at or above the largest
  // exact multiple of 62 are discarded instead, which costs an occasional extra
  // byte and yields a uniform distribution.
  const limit = 256 - (256 % ALPHABET.length); // 248
  let result = '';
  while (result.length < length) {
    const bytes = randomBytes(length);
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i] < limit) {
        result += ALPHABET[bytes[i] % ALPHABET.length];
      }
    }
  }
  return result;
}
