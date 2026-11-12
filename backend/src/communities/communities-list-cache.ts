/**
 * Which community list pages are cached, and under what key.
 *
 * `limit` and `offset` come from the client (the controller clamps them to
 * 1..50 and 0..5000, which still leaves hundreds of thousands of distinct
 * pages per list). Every cached page is a Redis key that is also recorded in
 * the invalidation tag set, and Redis here never evicts, so caching whatever
 * was asked for lets a client grow both without limit. Only the first page at
 * a page size clients actually use is cached; scrolling deeper reads the
 * database, which orders on an indexed column.
 *
 * The key format is unchanged for the pages still cached, so no version bump:
 * entries for other pages simply expire with their TTL.
 */

/** Page sizes the web and native clients (and older installed apps) request. */
export const LIST_CACHE_LIMITS: readonly number[] = [20, 30, 50];

type Visibility = 'public' | 'private' | undefined;

const VISIBILITIES: readonly Visibility[] = ['public', 'private', undefined];

function isCacheablePage(limit: number, offset: number): boolean {
  return offset === 0 && LIST_CACHE_LIMITS.includes(limit);
}

/** Key of the public/private browse list, or `null` when this page is not cached. */
export function allCommunitiesCacheKey(
  visibility: Visibility,
  limit: number,
  offset: number,
): string | null {
  if (!isCacheablePage(limit, offset)) return null;
  return `all:${visibility || 'any'}:${limit}:${offset}`;
}

/** Key of a college's campus list, or `null` when this page is not cached. */
export function campusCommunitiesCacheKey(
  collegeId: string,
  limit: number,
  offset: number,
): string | null {
  if (!isCacheablePage(limit, offset)) return null;
  return `campus:${collegeId}:${limit}:${offset}`;
}

/** Every browse-list key that can exist, for eviction by name. */
export function allCommunitiesCacheKeys(): string[] {
  return VISIBILITIES.flatMap((visibility) =>
    LIST_CACHE_LIMITS.flatMap((limit) => {
      const key = allCommunitiesCacheKey(visibility, limit, 0);
      return key ? [key] : [];
    }),
  );
}

/** Every campus-list key that can exist for a college. */
export function campusCommunitiesCacheKeys(collegeId: string): string[] {
  return LIST_CACHE_LIMITS.flatMap((limit) => {
    const key = campusCommunitiesCacheKey(collegeId, limit, 0);
    return key ? [key] : [];
  });
}
