import { randomUUID } from 'crypto';

/** What a caller-supplied request id may look like: log-safe and bounded. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The id to log a request under.
 *
 * `x-request-id` is attacker-controlled and ends up in log lines and response
 * headers, so a value with newlines, spaces, JSON or an unbounded length would
 * forge log entries. Only `[A-Za-z0-9._-]` up to 64 characters is accepted;
 * anything else is replaced by a fresh random UUID.
 */
export function requestIdFrom(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : randomUUID();
}
