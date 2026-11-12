import { createHash } from 'crypto';

/**
 * Building blocks for Redis cache keys that contain client-supplied text.
 *
 * Redis runs with `noeviction` and is shared by the job queues, sessions and
 * rate limits, so a cache whose key space is set by the client (every distinct
 * search string, every cursor) is not just wasteful: enough of it fills the
 * instance and the next write that matters is refused. Free text therefore
 * never goes into a key as typed. It is normalised, length-checked, and
 * replaced by a fixed-size digest, so the key's length no longer depends on
 * the input and a delimiter typed into the text cannot forge another field.
 */

/** Hex characters kept from the digest: 64 bits, far past any collision that matters in a 10-60 s cache. */
const DIGEST_LENGTH = 16;

/**
 * Case and surrounding space do not change what a search matches (all of them
 * are case-insensitive), so "Priya " and "priya" share one entry. Inner
 * whitespace is deliberately kept: `contains` matching treats "a  b" and "a b"
 * as different needles, and serving one's results for the other would be wrong.
 */
export function normalizeCacheText(raw: string | undefined | null): string {
  return (raw ?? '').trim().toLowerCase();
}

/** A fixed-length digest of `text`, safe to embed in a key. */
export function hashCacheKeyPart(text: string): string {
  return createHash('sha256')
    .update(text)
    .digest('hex')
    .slice(0, DIGEST_LENGTH);
}

/**
 * The key part for client text, or `null` when the text is too long to be
 * something a person typed. Callers skip the cache for `null` rather than
 * truncating: a truncated term would share an entry with a different one and
 * return the wrong results.
 */
export function boundedTextKeyPart(
  raw: string | undefined | null,
  maxLength: number,
): string | null {
  const text = normalizeCacheText(raw);
  if (text.length > maxLength) return null;
  return hashCacheKeyPart(text);
}
