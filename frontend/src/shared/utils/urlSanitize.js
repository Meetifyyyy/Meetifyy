/**
 * Returns true only for http: or https: URLs.
 * Blocks javascript:, data:, blob:, vbscript:, etc.
 */
export function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // If it's a relative URL, new URL(url) will fail without a base.
  // We should allow relative URLs by resolving against a dummy origin.
  try {
    const parsed = new URL(url, 'http://dummy.com');
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Returns the URL if safe, otherwise '#'.
 */
export function sanitizeUrl(url) {
  return isSafeUrl(url) ? url : '#';
}
