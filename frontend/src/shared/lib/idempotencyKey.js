/**
 * Idempotency keys for writes.
 *
 * The API answers a repeated `Idempotency-Key` with the first result instead of
 * performing the write again (backend IdempotencyInterceptor). That is what
 * makes a write safe to retry after its response was lost: a connection reset
 * after the server committed it, a timeout, the user tapping "Post" again on
 * an error that was not really one.
 *
 * Random from the platform CSPRNG. Never `Math.random`: a guessable key lets
 * another request claim someone's slot (CLAUDE.md §8).
 */
export function newIdempotencyKey() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // No CSPRNG at all: send no key, which the server treats as a plain write.
  return '';
}

/**
 * One key per submission, kept across the user's retries of it.
 *
 * `keyFor(payload)` returns the same key while the payload is unchanged, so
 * "failed, tap Post again" is recognised as the same post. A changed payload is
 * a different submission and gets a new key; reusing the old one would make the
 * server refuse it as a mismatch. Call `done()` after a success so the next
 * post, even with identical text, is a new one.
 */
export function createSubmissionKey() {
  let lastPayload = null;
  let key = '';
  return {
    keyFor(payload) {
      let serialized;
      try {
        serialized = JSON.stringify(payload ?? null);
      } catch {
        serialized = null;
      }
      if (!key || serialized === null || serialized !== lastPayload) {
        key = newIdempotencyKey();
        lastPayload = serialized;
      }
      return key;
    },
    done() {
      key = '';
      lastPayload = null;
    },
  };
}
