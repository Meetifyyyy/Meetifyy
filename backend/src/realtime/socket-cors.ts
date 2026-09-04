import { config } from '../config';

/**
 * Origin check for the Socket.IO handshake.
 *
 * Mirrors the HTTP CORS policy in main.ts: configured origins, wildcard
 * patterns, and local-network origins only where the environment allows them.
 * The gateway previously used `origin: true`, which reflects any Origin header
 * back and made the realtime endpoint reachable from any website — a materially
 * weaker policy than the HTTP API it sits beside.
 */
export function socketCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // Non-browser clients (and same-origin requests) send no Origin header.
  if (!origin) return callback(null, true);

  const { origins, originPatterns, allowLocalNetwork } = config.app.cors;

  const isLocalNetworkOrigin =
    allowLocalNetwork &&
    /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|100\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(
      origin,
    );

  const matchesPattern = (allowed: string) => {
    if (allowed === '*') return true;
    if (!allowed.includes('*')) return false;
    const regexPattern =
      '^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '[^.]*') + '$';
    return new RegExp(regexPattern, 'i').test(origin);
  };

  const allowed =
    origins.includes(origin) ||
    isLocalNetworkOrigin ||
    originPatterns.some(matchesPattern) ||
    origins.some(matchesPattern);

  callback(null, allowed);
}
