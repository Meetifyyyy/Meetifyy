/**
 * The Cache-Control an object is stored with, decided by its key.
 *
 * Shared by the provider's writes and the relocation routine so a moved object
 * ends up exactly as a freshly written one would be. Identity documents must
 * never be told to cache publicly for a year: a verification object once stayed
 * in a CDN edge long after the request that produced it had failed. Everything
 * else is written once under a unique key and never changes, so it is cached
 * hard — which also keeps a conversation's images from being refetched on
 * every view.
 *
 * No imports, so the command-line script can use it without loading the
 * application's configuration.
 */
export function cacheControlFor(key: string): string {
  return key.startsWith('verification/')
    ? 'private, no-store'
    : 'public, max-age=31536000, immutable';
}
