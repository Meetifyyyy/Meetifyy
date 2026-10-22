/**
 * The first page of the installed app's main tabs, kept on the device.
 *
 * Opening Messages, Notifications or the communities list after a launch used
 * to show a skeleton until the network answered, every time: nothing but the
 * Home feed (mobile/feedSnapshot.js) survived the process. Feed and chat apps
 * open on what the user last saw and refresh it in place (Instagram's offline
 * cache, Messenger's on-device store, Telegram's sync-on-start), and this does
 * the same for the lists a returning user opens first.
 *
 * - Restored lazily, the first time a screen asks for one of these queries
 *   while it has no data, so a tab opened long after launch still gets it and
 *   nothing is read that no screen wants.
 * - Always revalidated: a restored entry is marked stale (and invalidated, for
 *   queries such as the unread count whose staleTime is Infinity), so the
 *   network replaces it as soon as it answers. A network answer that lands
 *   before the disk read wins, and the snapshot is discarded.
 * - Scoped to the account that saved it, and stored in the IndexedDB cache
 *   that every sign-out and account switch empties (`idbClearAll`), with the
 *   same clear epoch, so a write in flight at sign-out is dropped.
 * - Trimmed to a first page and written at most every few seconds in idle
 *   time: the conversation list refetches on every message.
 *
 * Installed app only. The website deliberately keeps less on disk: a shared
 * machine must not open on the last person's inbox.
 */
import { hashKey } from '@tanstack/react-query';
import { idbEpoch, idbGet, idbSet } from '@shared/lib/idb';

/** Bumped when a stored shape changes; older entries are then ignored. */
const SNAPSHOT_VERSION = 1;
/** Older than this, a snapshot is too stale to be worth painting. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** At most one write per query in this window. */
const MIN_WRITE_INTERVAL_MS = 15_000;

/** What is kept, and how much of it. `trim` returns undefined to skip a shape it does not know. */
export const SNAPSHOTS = [
  {
    queryKey: ['conversations'],
    trim: (data) => (Array.isArray(data) ? data.slice(0, 30) : undefined),
  },
  {
    // The unfiltered notifications list: page one only, as the infinite query
    // stores it. Its cursor stays, since page two follows on from page one.
    queryKey: ['notifications'],
    trim: (data) =>
      Array.isArray(data?.pages) && data.pages.length > 0
        ? { pages: [data.pages[0]], pageParams: [data.pageParams?.[0]] }
        : undefined,
  },
  {
    queryKey: ['notifications', 'unreadCount'],
    trim: (data) => (data === undefined || data === null ? undefined : data),
  },
  {
    queryKey: ['communities', 'mine'],
    trim: (data) => (Array.isArray(data) ? data.slice(0, 100) : undefined),
  },
];

const byHash = new Map(SNAPSHOTS.map((s) => [hashKey(s.queryKey), s]));

/** The signed-in account this device holds, or null. */
function currentUserId(storage) {
  try {
    if (storage.getItem('loggedIn') !== 'true') return null;
    return JSON.parse(storage.getItem('currentUser') || 'null')?.id ?? null;
  } catch {
    return null;
  }
}

const entryKey = (userId, hash) => `${userId}:${hash}`;

/**
 * Wires the snapshots to `queryClient`. Returns an unsubscribe function.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export function installQuerySnapshots(
  queryClient,
  { storage = window.localStorage, now = () => Date.now() } = {},
) {
  const lastWrite = new Map();
  const pendingWrites = new Set();
  /** Snapshots read ahead at install, by query hash, for a restore without a skeleton frame. */
  const preloaded = new Map();
  /**
   * The clear generation the state above belongs to. A sign-out or account
   * switch bumps it, and then none of it applies: a save scheduled for the
   * previous account must not hold back the next account's first save, and a
   * preloaded snapshot belongs to whoever was signed in at install.
   */
  let stateEpoch = idbEpoch();
  const syncEpoch = () => {
    const current = idbEpoch();
    if (current === stateEpoch) return;
    stateEpoch = current;
    lastWrite.clear();
    pendingWrites.clear();
    preloaded.clear();
  };

  const idle = (fn) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 3000 });
    } else {
      setTimeout(fn, 500);
    }
  };

  /** The stored value if it may be painted for `userId`, else null. */
  const usable = (value, userId) => {
    if (!value || value.v !== SNAPSHOT_VERSION || value.userId !== userId) return null;
    if (typeof value.savedAt !== 'number' || now() - value.savedAt > MAX_AGE_MS) return null;
    return value;
  };

  const apply = (spec, value, userId) => {
    // Only into an empty slot: a network answer that landed during the read
    // is newer, and an account change meanwhile has emptied the cache.
    if (queryClient.getQueryData(spec.queryKey) !== undefined) return;
    if (currentUserId(storage) !== userId) return;
    if (!usable(value, userId)) return;
    // `updatedAt` is when it was really fetched, so it counts as stale.
    queryClient.setQueryData(spec.queryKey, value.data, { updatedAt: value.savedAt });
    // And invalidated, for queries whose staleTime would otherwise keep a
    // restored value as the answer (the unread count is Infinity).
    queryClient.invalidateQueries({ queryKey: spec.queryKey, exact: true, refetchType: 'none' });
  };

  const restore = async (query, spec) => {
    const userId = currentUserId(storage);
    if (!userId) return;
    // idbGet itself returns null across a clear.
    const entry = await idbGet('queries', entryKey(userId, query.queryHash));
    apply(spec, entry?.value, userId);
  };

  /** Synchronous restore from the read-ahead. False when there was nothing usable. */
  const restoreNow = (query, spec) => {
    syncEpoch();
    const value = preloaded.get(query.queryHash);
    if (!value) return false;
    preloaded.delete(query.queryHash);
    const userId = currentUserId(storage);
    if (!userId || !usable(value, userId)) return false;
    apply(spec, value, userId);
    return true;
  };

  // Read ahead for whoever is signed in now, so a tab opened right after
  // launch paints its list in the first frame instead of a skeleton.
  const preloadUser = currentUserId(storage);
  if (preloadUser) {
    const epoch = idbEpoch();
    for (const spec of SNAPSHOTS) {
      const hash = hashKey(spec.queryKey);
      void idbGet('queries', entryKey(preloadUser, hash))
        .then((entry) => {
          const value = usable(entry?.value, preloadUser);
          if (!value || epoch !== idbEpoch()) return;
          syncEpoch();
          preloaded.set(hash, value);
        })
        .catch(() => {}); // a failed read-ahead just means the async path
    }
  }

  const save = (hash, epoch) => {
    // Scheduled before a sign-out: the state it would touch is the next account's.
    if (epoch !== idbEpoch()) return;
    pendingWrites.delete(hash);
    const spec = byHash.get(hash);
    // Looked up again at idle time: a sign-out in between has removed it.
    const query = queryClient.getQueryCache().find({ queryKey: spec.queryKey, exact: true });
    const userId = currentUserId(storage);
    if (!query || !userId || query.state.status !== 'success') return;
    const data = spec.trim(query.state.data);
    if (data === undefined) return;
    lastWrite.set(hash, now());
    void idbSet(
      'queries',
      entryKey(userId, hash),
      { v: SNAPSHOT_VERSION, userId, savedAt: query.state.dataUpdatedAt || now(), data },
      epoch,
    );
  };

  return queryClient.getQueryCache().subscribe((event) => {
    const query = event?.query;
    const spec = query && byHash.get(query.queryHash);
    if (!spec) return;

    if (event.type === 'observerAdded') {
      if (query.state.data === undefined && !restoreNow(query, spec)) void restore(query, spec);
      return;
    }

    if (event.type !== 'updated' || event.action?.type !== 'success') return;
    if (event.action.manual) return; // setQueryData, the restore above included
    const hash = query.queryHash;
    syncEpoch();
    if (pendingWrites.has(hash)) return;
    pendingWrites.add(hash);
    const epoch = idbEpoch();
    // Trailing, not skipped: a refetch inside the window is written once the
    // window has passed, so the disk ends on the latest list, not an older one.
    const wait = Math.max(0, MIN_WRITE_INTERVAL_MS - (now() - (lastWrite.get(hash) ?? 0)));
    setTimeout(() => idle(() => save(hash, epoch)), wait);
  });
}
