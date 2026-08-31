/**
 * The single definition of how an unavailable user is presented.
 *
 * "Unavailable" covers both halves of the deletion lifecycle, because from
 * every other user's point of view they are the same thing:
 *   - PENDING_DELETION — inside the 30-day window; the row still holds the real
 *     name and avatar, so those MUST be substituted here rather than leaked.
 *   - DELETED — purged; the row was anonymized, but a message row still points
 *     at it and needs something to render.
 *
 * This lives in `common/` and is applied in the serialization layer rather than
 * in any one screen. A frontend component that special-cases a deleted user is
 * a bug waiting to happen: the next endpoint that returns a user object would
 * leak the real identity. Backends call `presentUser` and every client renders
 * the same thing for free.
 */

export const DELETED_USER_DISPLAY_NAME = 'Deleted User';

/**
 * Username shown for an unavailable account. Deliberately not the real
 * username and not the anonymized `deleted_xxxx_123` one either — neither is
 * useful to a reader and the first is the identity we are hiding.
 */
export const DELETED_USER_USERNAME = 'deleted';

/** Null avatar; clients already fall back to their default avatar asset. */
export const DELETED_USER_AVATAR = null;

export interface UserIdentityLike {
  id: string;
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  cover?: string | null;
  bio?: string | null;
  accountStatus?: string | null;
  deletedAt?: Date | string | null;
  verificationStatus?: string | null;
  isCampusRep?: boolean | null;
  [key: string]: any;
}

/**
 * True once an account must stop being presented as a real person.
 *
 * `deletedAt` alone is the load-bearing signal — it is stamped the instant
 * deletion is requested and cleared on recovery — but `accountStatus` is
 * checked too so a row in either terminal state is caught even if a caller
 * selected only one of the two columns.
 */
export function isUnavailableUser(
  user: UserIdentityLike | null | undefined,
): boolean {
  if (!user) return true;
  if (user.deletedAt) return true;
  const status = user.accountStatus;
  return status === 'DELETED' || status === 'PENDING_DELETION';
}

/**
 * Replaces an unavailable user's identity with the tombstone representation,
 * preserving `id` so existing rows (messages, comments, reactions) still key
 * correctly. Returns the user untouched when they are available.
 *
 * Extra fields the caller selected are dropped rather than passed through:
 * whitelisting is the only version of this that stays correct when someone
 * later adds a column to the select.
 */
export function presentUser<T extends UserIdentityLike>(
  user: T | null | undefined,
): T | null {
  if (!user) return null;
  if (!isUnavailableUser(user)) return user;
  return {
    id: user.id,
    username: DELETED_USER_USERNAME,
    displayName: DELETED_USER_DISPLAY_NAME,
    avatar: DELETED_USER_AVATAR,
    cover: null,
    bio: null,
    isDeleted: true,
    // No profile link should resolve; clients check this flag to render the
    // name as plain text instead of an anchor.
    profileAvailable: false,
    verificationStatus: 'UNVERIFIED',
    isCampusRep: false,
  } as unknown as T;
}

/** Convenience for the name-only call sites (message previews, toasts). */
export function presentUserName(
  user: UserIdentityLike | null | undefined,
): string {
  if (isUnavailableUser(user)) return DELETED_USER_DISPLAY_NAME;
  return user?.displayName || user?.username || 'User';
}

/** Convenience for the avatar-only call sites. */
export function presentUserAvatar(
  user: UserIdentityLike | null | undefined,
): string | null {
  if (isUnavailableUser(user)) return DELETED_USER_AVATAR;
  return user?.avatar ?? null;
}
