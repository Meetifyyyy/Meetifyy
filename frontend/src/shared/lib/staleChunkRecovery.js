/**
 * Recovery from a lazy-import failure caused by a stale build.
 *
 * When a deploy lands, the new build's chunks carry new content hashes and the
 * old ones stop existing. A tab that was already open still holds the previous
 * chunk graph, so the next lazy route it tries to load requests a filename the
 * server no longer has and gets a 404. React surfaces that as
 * "Failed to fetch dynamically imported module", and the route dies.
 *
 * This is categorically different from an ordinary route error, and that
 * distinction is the whole reason this exists. `RouteErrorBoundary`
 * deliberately does not reload on errors — a sound policy, since reloading can
 * loop and can discard what someone was typing. But for THIS error the retry
 * button is useless: it re-requests the same missing URL, forever. The only
 * thing that can fix it is fetching a fresh index.html, which means a reload.
 *
 * The service-worker update path in main.jsx does not cover this. It promotes a
 * waiting worker while the tab is hidden — but the dev deployment registers no
 * worker at all, and in production a tab open at the moment of a deploy is
 * broken before any of that machinery runs.
 *
 * Safety comes from the one-shot guard: a reload is attempted at most once per
 * tab per window of time. If the route still fails afterwards, the cause was
 * not staleness and the error screen is shown, so a genuinely missing chunk
 * cannot put the tab into a reload loop.
 */

const RELOAD_MARKER = 'meetifyy:stale-chunk-reload';

/**
 * How long a recorded reload suppresses another one.
 *
 * Long enough that a broken deploy cannot cause repeated reloads, short enough
 * that a tab left open across two separate deploys can still recover from the
 * second one.
 */
const RELOAD_COOLDOWN_MS = 60_000;

/**
 * Browsers word this differently, and matching only Chrome's phrasing would
 * leave Firefox and Safari users stuck on the dead route.
 */
const STALE_CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /dynamically imported module.*(404|not found)/i,
];

export function isStaleChunkError(error) {
  if (!error) return false;
  const message =
    typeof error === 'string' ? error : `${error.message ?? ''} ${error.name ?? ''}`;
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Attempts a one-shot reload for a stale-chunk error.
 *
 * @returns true when a reload was started — the caller should render nothing
 *          further, because the page is on its way out.
 */
export function recoverFromStaleChunk(
  error,
  {
    storage = globalThis.sessionStorage,
    reload = () => globalThis.location?.reload(),
    now = () => Date.now(),
  } = {}
) {
  if (!isStaleChunkError(error)) return false;

  let last = 0;
  try {
    last = Number(storage?.getItem(RELOAD_MARKER)) || 0;
  } catch {
    // Private mode. Without a marker there is no way to guarantee one-shot, so
    // the safe choice is to NOT reload and let the error screen show — a
    // possible reload loop is a worse failure than a visible error.
    return false;
  }

  if (last && now() - last < RELOAD_COOLDOWN_MS) {
    // Already tried. The reload did not fix it, so this is not staleness.
    return false;
  }

  try {
    storage.setItem(RELOAD_MARKER, String(now()));
  } catch {
    return false;
  }

  reload();
  return true;
}

/** Clears the marker once the app has loaded successfully again. */
export function clearStaleChunkMarker(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(RELOAD_MARKER);
  } catch {
    /* nothing to clean up */
  }
}
