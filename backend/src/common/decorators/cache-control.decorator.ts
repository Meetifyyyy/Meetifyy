import { SetMetadata } from '@nestjs/common';

export const CACHE_CONTROL_KEY = 'cache-control';

/**
 * Sets a custom Cache-Control header on the HTTP response for this route.
 *
 * Examples:
 *   @CacheControl('public, max-age=60')         — cacheable for 60s by anyone
 *   @CacheControl('private, max-age=30')        — cacheable only in the browser for 30s
 *   @CacheControl('no-store')                   — never cache (default for mutations)
 *
 * If this decorator is NOT applied, the NoCacheInterceptor falls back to 'no-store'.
 */
export const CacheControl = (value: string) =>
  SetMetadata(CACHE_CONTROL_KEY, value);
