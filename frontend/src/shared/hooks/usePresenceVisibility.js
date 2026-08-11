import { useAuth } from '../context/AuthContext';

/**
 * Reciprocity gate for presence display.
 *
 * A user who has turned OFF their own "Show online status" must not be able to
 * see anyone else's online status. This is the single source of truth for that
 * rule on the render side — every presence indicator (online dots, "Online"
 * text, last-seen) should pass its raw online flag through this gate so it can
 * never leak, regardless of what a cached query or a racing socket event holds.
 *
 * Returns `true` when the current user is allowed to see others' presence.
 */
export function useCanSeeOthersPresence() {
  const { currentUser } = useAuth() || {};
  const own =
    currentUser?.settings?.showOnlineStatus ??
    currentUser?.preferences?.showOnlineStatus;
  return own !== false;
}
