import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_DELETION_KEY = 'allowPendingDeletion';

/**
 * Marks a route an account inside its 30-day deletion window may still reach.
 *
 * The session is deliberately kept alive: the whole point of the window is that
 * the owner can sign back in and change their mind, and they cannot do that
 * without a working token. `JwtGuard` therefore refuses every authenticated
 * route that does NOT carry this decorator, which is what makes the recovery
 * screen an explanation rather than the enforcement. Exactly three handlers
 * carry it today — deletion status, recover, and sign-out — and every addition
 * widens what a deleting account can still do, so it should be deliberate.
 */
export const AllowPendingDeletion = () =>
  SetMetadata(ALLOW_PENDING_DELETION_KEY, true);
