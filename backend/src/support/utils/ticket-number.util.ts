import { randomBytes } from 'crypto';

/**
 * Crockford base32 minus I, L, O and U: the four characters a person is most
 * likely to mistranscribe when reading an ID back over the phone or copying it
 * out of an email. 28 symbols over 6 places is ~4.8 x 10^8 combinations.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.replace(/[ILOU]/g, '');

const PREFIX = 'MFT';
const BODY_LENGTH = 6;

/** Matches the format produced below; used to validate lookups. */
export const TICKET_NUMBER_PATTERN = new RegExp(`^${PREFIX}-[${ALPHABET}]{${BODY_LENGTH}}$`);

/**
 * Generates a support request ID such as `MFT-8K4P2Q`.
 *
 * Random rather than sequential on purpose: a sequential ID would let anyone
 * holding one request number infer how many requests the platform has received
 * and address neighbouring tickets. Uniqueness is still guaranteed by the
 * unique index on the column, not by the entropy here - the caller retries on
 * a collision.
 */
export function generateTicketNumber(): string {
  // rejection-sampled: 256 % 28 != 0, so a plain modulo would make the first
  // 4 symbols of the alphabet very slightly more likely than the rest.
  const body: string[] = [];
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (body.length < BODY_LENGTH) {
    for (const byte of randomBytes(BODY_LENGTH)) {
      if (byte >= limit) continue;
      body.push(ALPHABET[byte % ALPHABET.length]);
      if (body.length === BODY_LENGTH) break;
    }
  }
  return `${PREFIX}-${body.join('')}`;
}
