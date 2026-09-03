/**
 * Turning a browser network failure into something a user and a support ticket
 * can both act on.
 *
 * `TypeError: Failed to fetch` is what the browser throws when a request never
 * produced a response at all. It is deliberately vague — the spec hides the
 * reason so a page cannot probe the network — but showing it to a user is
 * useless, and pasting it into a bug report tells nobody anything. Worse, it is
 * indistinguishable at a glance from a server error, so it sends people looking
 * at the wrong system.
 *
 * The distinction that matters: a "failed to fetch" means the request did NOT
 * reach the server. Nothing was created, nothing was charged, nothing was sent.
 * Any error that carries an HTTP status did reach it, and means something else
 * entirely.
 */

/** True when the browser gave up before getting a response. */
export function isNetworkLevelFailure(err) {
  if (!err) return false;
  // A response-bearing error is not a network failure, whatever it says.
  if (err.status || err.statusCode || err.__isAuthError === false) return false;
  const name = String(err.name || '');
  const msg = String(err.message || '').toLowerCase();
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (name !== 'TypeError' && name !== 'NetworkError') return false;
  return (
    msg.includes('failed to fetch') ||        // Chrome, Edge
    msg.includes('networkerror') ||           // Firefox
    msg.includes('load failed') ||            // Safari
    msg.includes('network request failed') ||
    msg.includes('connection')
  );
}

/**
 * A message that says what actually happened, and what to try.
 *
 * @param {Error} err        the thrown error
 * @param {object} [options]
 * @param {string} [options.host]   the host the request was going to
 * @param {string} [options.action] what the user was doing, e.g. "create your account"
 */
export function describeNetworkError(err, { host, action = 'complete that' } = {}) {
  if (!isNetworkLevelFailure(err)) return null;

  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return `The server took too long to respond, so we stopped waiting. Your account was not created — check your connection and try again.`;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return `You appear to be offline. Reconnect and try again — nothing was submitted.`;
  }

  // Online, but the request never arrived. On a campus or office network this
  // is usually a filter or a browser extension blocking the destination, which
  // the user can act on once they know which host it is.
  const where = host ? ` (${host})` : '';
  return (
    `Couldn't reach the service we need to ${action}${where}. Nothing was submitted. `
    + 'This is usually a network blocking it — try a different network, or turn off '
    + 'a VPN or ad blocker, then try again.'
  );
}

/**
 * Logs the real error alongside context, so the console shows what the message
 * cannot. Kept separate from the message: users get plain English, the console
 * gets the detail a bug report needs.
 */
export function logNetworkFailure(scope, err, context = {}) {
  try {
    // eslint-disable-next-line no-console
    console.error(`[${scope}] request failed before reaching the server`, {
      name: err?.name,
      message: err?.message,
      online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
      ...context,
    });
  } catch {
    // Logging must never be the thing that breaks a flow.
  }
}
