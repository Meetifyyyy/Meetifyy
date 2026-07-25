import { randomBytes } from 'crypto';

/**
 * URL-safe 62-character alphabet (A-Z, a-z, 0-9)
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

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
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
}
