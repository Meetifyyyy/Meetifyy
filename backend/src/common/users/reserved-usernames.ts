import { DELETED_USER_USERNAME } from './deleted-user';

/**
 * Handles nobody may register or rename themselves to.
 *
 * Shared rather than inline because it has to be enforced in TWO places, and
 * was only in one: signup checked it, the profile update did not. Anyone could
 * therefore register an ordinary name and then rename themselves to `admin`,
 * `support` or `meetifyy` — the list existed but the rename path walked
 * straight past it.
 */
const RESERVED_EXACT = new Set<string>([
  // Platform and staff impersonation.
  'admin',
  'administrator',
  'meetify',
  'meetifyy',
  'help',
  'support',
  'root',
  'official',
  'system',
  'staff',
  'moderator',
  'mod',
  'security',
  'noreply',
  'no-reply',

  // Route collisions — a username that shadows a path breaks profile links.
  'api',
  'auth',
  'settings',
  'home',
  'campus',
  'crew',
  'profile',
  'login',
  'signup',
  'onboarding',
  'terms',
  'privacy',
  'about',
  'contact',
  'explore',
  'feed',
  'search',
  'messages',
  'notifications',
  'communities',
  'activities',

  // Values that break rendering or comparison when they reach a template.
  'null',
  'undefined',

  // ── Deleted-account impersonation ────────────────────────────────────────
  // The tombstone presenter renders every unavailable account under
  // `DELETED_USER_USERNAME`. If a real person could hold that handle, they
  // would be indistinguishable from a deleted account in every list the
  // presenter touches — and, worse, could claim the identity a real deletion
  // is meant to erase.
  DELETED_USER_USERNAME,
  'deleteduser',
  'deleted_user',
  'deleted-user',
  'deletedaccount',
  'deleted_account',
  'accountdeleted',
  'removeduser',
  'removed_user',
]);

/**
 * Prefixes nobody may register under.
 *
 * `deleted_` is the shape the purge writes when it anonymizes a row
 * (`deleted_<id fragment>_<timestamp>`). Reserving the whole prefix means a
 * user cannot hand-craft a handle that looks like a purged account — which
 * would let them impersonate one, and would also collide with a real purge
 * that later tries to write the same value.
 */
const RESERVED_PREFIXES = ['deleted_', 'meetifyy_', 'admin_'];

/**
 * True when `username` may not be taken.
 *
 * Case- and whitespace-insensitive: the caller is expected to have lowercased
 * already, but this normalizes anyway rather than trusting every call site to
 * remember — the cost of being wrong here is an impersonation, not a typo.
 */
export function isReservedUsername(
  username: string | null | undefined,
): boolean {
  const normalized = String(username ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;

  if (RESERVED_EXACT.has(normalized)) return true;
  return RESERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Deliberately vague, so the list is not enumerable through the endpoint. */
export const RESERVED_USERNAME_MESSAGE = 'Username not available';
