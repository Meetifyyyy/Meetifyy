/**
 * Resolving the client address for rate limiting.
 *
 * Express already does the hard part once `trust proxy` is set to the real hop
 * count: it walks X-Forwarded-For from the RIGHT (the end our infrastructure
 * appends to) and hands back the first address beyond the trusted hops. That is
 * the only correct read of the header.
 *
 * What this file adds is the normalisation Express does not do, and the
 * deliberate refusal to ever look at a proxy header by hand.
 */

/**
 * Collapses an IPv6 address to its /64 prefix.
 *
 * A single IPv6 customer allocation is commonly a /64 — 2^64 addresses. Keying
 * a rate limit on the full address therefore hands an IPv6 client an unlimited
 * supply of fresh buckets, which is the same as having no limit at all. IPv4 is
 * returned unchanged; there is no equivalent free-address problem there.
 */
export function normalizeIp(raw: string | undefined | null): string {
  if (!raw) return 'unknown';

  let ip = String(raw).trim().toLowerCase();
  if (!ip) return 'unknown';

  // Node reports IPv4 over a dual-stack socket as ::ffff:127.0.0.1.
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (mapped.includes('.')) return mapped;
  }

  // Strip a zone index (fe80::1%eth0) — not part of the address identity.
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);

  if (!ip.includes(':')) return ip; // IPv4

  return ipv6Prefix64(ip);
}

/** First four hextets of an IPv6 address, expanded from any `::` shorthand. */
function ipv6Prefix64(ip: string): string {
  const halves = ip.split('::');
  let hextets: string[];

  if (halves.length === 2) {
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return ip; // malformed — key on it verbatim
    hextets = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    hextets = ip.split(':');
  }

  if (hextets.length < 4) return ip;

  return hextets
    .slice(0, 4)
    .map((h) => (h === '' ? '0' : h.replace(/^0+(?=.)/, '')))
    .join(':');
}

/**
 * The client address for this request.
 *
 * Reads `req.ip` exclusively. Proxy headers are NEVER parsed here.
 *
 * The guards this replaces each did their own `x-forwarded-for.split(',')[0]`,
 * which takes the LEFTMOST entry — the one the caller supplied. Any client
 * could send `X-Forwarded-For: <random>` and mint a fresh bucket per request,
 * so login brute-force, account-enumeration and support-form protection were
 * all defeated by a one-line change in a script. `req.ip` with a correct
 * `trust proxy` is the fix; nothing else in this codebase should look at the
 * header.
 */
export function clientIp(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return normalizeIp(request?.ip || request?.socket?.remoteAddress);
}
