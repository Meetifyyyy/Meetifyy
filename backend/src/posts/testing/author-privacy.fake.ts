import type { AuthorPrivacyFields } from '../author-visibility';

/**
 * The account row `authorPrivacySelect` loads, for specs that stand in for
 * `prisma.user.findUnique`. `followers` is the viewer's own follow row, exactly
 * as the real select returns it: one entry when the viewer follows, none when
 * not (and none while only a follow REQUEST is pending, which grants nothing).
 */
export const PUBLIC_AUTHOR: AuthorPrivacyFields = {
  settings: null,
  followers: [],
};

export function privateAuthor(followedBy: string[] = []): AuthorPrivacyFields {
  return {
    settings: { privateProfile: true },
    followers: followedBy.map((followerId) => ({ followerId })),
  };
}

/** True when a `user.findUnique` call is the author-privacy lookup. */
export function isAuthorPrivacyLookup(args: unknown): boolean {
  if (typeof args !== 'object' || args === null || !('select' in args)) {
    return false;
  }
  const { select } = args;
  return typeof select === 'object' && select !== null && 'settings' in select;
}
