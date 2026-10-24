/**
 * Runs `request(token)` with a live grant from `ensure()`. If the server
 * answers `reauth_required` (the grant expired, or was replaced from another
 * device), the grant is dropped, the person is asked once more, and the
 * request is retried with the new one. The server checks the grant before it
 * spends a code, so the retry never costs one.
 *
 * `optional`: try first with whatever grant is already held (possibly none),
 * and ask only if the server says one is needed — for the college email,
 * where an account's first verification needs none.
 */
export async function withReauth({ ensure, invalidate, current }, request, { optional = false } = {}) {
  const token = optional ? current() : await ensure();
  try {
    return await request(token);
  } catch (err) {
    if (err?.code !== 'reauth_required') throw err;
    invalidate();
    return request(await ensure());
  }
}
