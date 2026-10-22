/**
 * What an action does when the device has no network.
 *
 * ONE RULE PER KIND OF ACTION
 *
 *   - Messages: queued. They have a durable outbox with retry and visible
 *     "Sending…" / "Not delivered" states (features/messages/shared/utils/outbox),
 *     so going offline loses nothing and the person can see where it stands.
 *   - Creates (post, comment, activity, community, event, support request):
 *     REFUSED while offline, with a message, and the form or draft is left
 *     exactly as it was. They are not queued because a background queue cannot
 *     be honest about them: media is uploaded before the post, the server
 *     validates and moderates, and a post that appears hours later, or a
 *     "posted!" that was never true, is worse than being asked to try again.
 *   - Toggles (like, follow, join, save): refused with a toast and NOT applied.
 *     An optimistic flip followed seconds later by a rollback is a lie in two
 *     steps; an unpressed button plus one clear sentence is not.
 *
 * Works with the QueryClient's mutation `networkMode: 'always'` (see
 * `mutationDefaults`): TanStack's default, 'online', PAUSES a mutation while
 * offline and runs it whenever the connection returns, which is a hidden queue
 * with a spinner that never ends and a success nobody was watching for.
 * 'always' makes it run now and fail fast; this guard is what refuses first.
 */
import { isOnline } from './networkStatus';
import { isNetworkLevelFailure } from '../utils/networkErrors';
import { showToast } from '../utils/toast';

const MESSAGES = {
  post: "You're offline. Your post is saved as a draft; post it when you're back online.",
  comment: "You're offline. Your comment is saved as a draft; send it when you're back online.",
  activity: "You're offline. What you've entered is kept; create your activity when you're back online.",
  community: "You're offline. What you've entered is kept; create your community when you're back online.",
  event: "You're offline. What you've entered is kept; create your event when you're back online.",
  support: "You're offline. Your request is kept on this screen; send it when you're back online.",
  action: "You're offline. Reconnect to do that.",
};

/** The sentence shown when `kind` is refused offline. */
export function offlineMessage(kind = 'action') {
  return MESSAGES[kind] ?? MESSAGES.action;
}

/**
 * True, after showing the reason, when the device is offline and the action
 * must not go ahead. Call it first, before anything optimistic or destructive
 * (clearing a composer, applying a toggle, closing a dialog).
 */
export function blockIfOffline(kind = 'action') {
  if (isOnline()) return false;
  showToast(offlineMessage(kind), 'error', { duration: 4000 });
  return true;
}

/** An Error that says the action was refused for lack of a network. */
export class OfflineError extends Error {
  constructor(kind = 'action') {
    super(offlineMessage(kind));
    this.name = 'OfflineError';
    this.code = 'OFFLINE';
  }
}

/**
 * For code that reports its own failures (a `catch` that toasts `err.message`):
 * throws an `OfflineError`, without a toast of its own, when offline.
 */
export function assertOnline(kind = 'action') {
  if (!isOnline()) throw new OfflineError(kind);
}

export function isOfflineError(err) {
  return err?.code === 'OFFLINE' && err?.name === 'OfflineError';
}

/**
 * The sentence for a failed submit. A request that never got a response (signal
 * dropped mid-send, timeout) says so and promises the draft is still there; any
 * other error keeps the server's own words.
 *
 * The retry that follows is safe: every create sends an idempotency key per
 * submission, so a first copy that did reach the server is replayed rather than
 * written twice.
 */
export function submitErrorMessage(err, fallback = 'Something went wrong. Try again.') {
  if (isOfflineError(err)) return err.message;
  if (isNetworkLevelFailure(err)) {
    return isOnline()
      ? "Couldn't reach Meetifyy. What you wrote is kept; try again."
      : offlineMessage('action');
  }
  const message = Array.isArray(err?.message) ? err.message[0] : err?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
