import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_KEY = 'allowSuspended';

/**
 * Marks a route a suspended account may still reach.
 *
 * A suspended user keeps a valid session on purpose — they need to be able to
 * sign in, be told what happened, and appeal it. Everything else is refused by
 * `JwtGuard`, so the suspension is enforced by the server rather than by the
 * screen the client happens to render. Only the handful of endpoints that
 * serve that flow carry this decorator; adding it anywhere else widens what a
 * suspended account can do, so it should be a deliberate decision every time.
 */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
