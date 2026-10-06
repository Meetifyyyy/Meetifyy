/**
 * The one place shared code reports to error monitoring.
 *
 * Error boundaries, the API client and the auth context call these functions;
 * none of them imports a Sentry SDK. Each entry point installs the adapter for
 * its platform before rendering (`platform/web/sentry.js` for the website,
 * `platform/capacitor/sentry.js` for the app), so the website bundle never
 * contains Capacitor code and the shared layer stays platform-free.
 *
 * Until an adapter is installed — tests, a build with no DSN, Sentry disabled —
 * every function is a silent no-op. They also never throw: reporting an error
 * must not become a second error.
 */

let adapter = null;

/**
 * Calls made before the adapter arrives, when one is known to be on its way.
 *
 * The website loads Sentry lazily, after first paint, to keep ~50 KB out of the
 * entry chunk. Between boot and then, reports are held here (bounded) and
 * replayed in order once the SDK is installed, so an error during start-up is
 * not lost. Without `bufferUntilInstalled()` nothing is held: a build with
 * Sentry off never accumulates anything.
 */
let pending = null;
let pendingLimit = 0;

export function bufferUntilInstalled(limit = 30) {
  if (!adapter && !pending) {
    pending = [];
    pendingLimit = limit;
  }
}

/** Sentry did not load after all: drop whatever was held. */
export function stopBuffering() {
  pending = null;
}

export function installMonitoring(next) {
  adapter = next || null;
  const held = pending;
  pending = null;
  if (adapter && held) {
    for (const op of held) {
      try {
        op(adapter);
      } catch {
        // One bad report must not stop the rest.
      }
    }
  }
}

export function isMonitoringActive() {
  return adapter !== null;
}

function safely(fn) {
  if (!adapter) {
    if (pending && pending.length < pendingLimit) pending.push(fn);
    return;
  }
  try {
    fn(adapter);
  } catch {
    // Monitoring is best-effort by definition.
  }
}

/**
 * An error the app handled (so the SDK's global handlers never see it) but that
 * still deserves a report — a render crash caught by an error boundary.
 *
 * @param {unknown} error
 * @param {{ feature?: string, tags?: Record<string,string>, extra?: Record<string,unknown> }} [context]
 *   Never put user content in `extra`: keys that look sensitive are redacted,
 *   but the safest data is the data that was never passed.
 */
export function captureError(error, context = {}) {
  safely((a) => a.captureError(error, context));
}

/** A breadcrumb: what happened just before an error. No user content. */
export function addBreadcrumb(crumb) {
  safely((a) => a.addBreadcrumb(crumb));
}

/** The signed-in account, by internal id only. */
export function setMonitoringUser(id) {
  safely((a) => a.setUser(id ? { id: String(id) } : null));
}

/** Sign-out: nothing about the previous account may follow the next session. */
export function clearMonitoringUser() {
  safely((a) => a.setUser(null));
}

/**
 * The adapter over the four Sentry calls the app uses (from `@sentry/react` on
 * the website, `@sentry/capacitor` in the app). Pass the functions, not the
 * SDK namespace object: a namespace used as a value cannot be tree-shaken. Each
 * captured error gets its own scope, so a feature tag set for one report never
 * sticks to the next.
 */
export function createSentryAdapter(Sentry) {
  return {
    captureError(error, { feature, tags, extra } = {}) {
      Sentry.withScope((scope) => {
        if (feature) scope.setTag('feature', feature);
        if (tags) scope.setTags(tags);
        if (extra) scope.setExtras(extra);
        Sentry.captureException(error);
      });
    },
    addBreadcrumb(crumb) {
      Sentry.addBreadcrumb(crumb);
    },
    setUser(user) {
      Sentry.setUser(user);
    },
  };
}
