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
 * - The Campus page's queries are kept too, tagged with the college the
 *   account belonged to when they were saved, and restored only while that is
 *   still its college: losing the affiliation or switching college makes the
 *   old college's lists unusable, never shown.
 * - A community or activity opened lately keeps its detail query (the most
 *   recent few per account), so reopening one with no network still shows it.
 *   A 403/404 for one deletes its entry, as the access-denied handling does for
 *   the in-memory copy.
 *
 * Installed app only. The website deliberately keeps less on disk: a shared
 * machine must not open on the last person's inbox.
 */
import { hashKey } from '@tanstack/react-query';
import { idbDelete, idbEpoch, idbGet, idbSet } from '@shared/lib/idb';
import { isAffiliationActive } from '@shared/lib/campusAccess';

/** Bumped when a stored shape changes; older entries are then ignored. */
const SNAPSHOT_VERSION = 1;
/** Older than this, a snapshot is too stale to be worth painting. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** At most one write per query in this window. */
const MIN_WRITE_INTERVAL_MS = 15_000;

/** Page one of an infinite query, as it stores it; its cursor stays so page two follows on. */
const firstPage = (data) =>
  Array.isArray(data?.pages) && data.pages.length > 0
    ? { pages: [data.pages[0]], pageParams: [data.pageParams?.[0]] }
    : undefined;

/** A detail record as it came, or undefined for anything that is not one. */
const record = (data) => (data && typeof data === 'object' && !Array.isArray(data) ? data : undefined);

/**
 * What is kept, and how much of it. `trim` returns undefined to skip a shape it
 * does not know. `campus` marks the college-scoped ones (see `campusScope`).
 */
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
  // Campus: what its page paints. The people row and the community cards need
  // a handful each; the events and activities are the first page.
  {
    queryKey: ['users', 'campus', 50],
    campus: true,
    trim: (data) => (Array.isArray(data) ? data.slice(0, 50) : undefined),
  },
  {
    queryKey: ['communities', 'campus'],
    campus: true,
    trim: (data) => (Array.isArray(data) ? data.slice(0, 50) : undefined),
  },
  { queryKey: ['campus-events', 'scope', 'upcoming'], campus: true, trim: firstPage },
  { queryKey: ['activities', 'campus', { limit: 4 }], campus: true, trim: firstPage },
];

/**
 * Detail queries keyed `[root, id]`, of which the most recent `max` per account
 * are kept. The key is part of the identity, so these cannot be listed ahead
 * like SNAPSHOTS and are matched by shape instead.
 */
export const DETAIL_SNAPSHOTS = [
  { name: 'community', root: 'community', max: 8, trim: record },
  { name: 'activity', root: 'activity', max: 8, trim: record },
];

const byHash = new Map(SNAPSHOTS.map((s) => [hashKey(s.queryKey), s]));

/** The spec that keeps `queryKey`, or undefined. */
function specFor(queryKey, queryHash) {
  const fixed = byHash.get(queryHash);
  if (fixed) return fixed;
  if (!Array.isArray(queryKey) || queryKey.length !== 2 || typeof queryKey[1] !== 'string' || !queryKey[1]) return undefined;
  const detail = DETAIL_SNAPSHOTS.find((d) => d.root === queryKey[0]);
  return detail ? { ...detail, queryKey } : undefined;
}

/**
 * The college this account's Campus belongs to, or null when it has none.
 * Read from the cached user, the same copy `currentUserId` reads.
 */
function campusScope(storage) {
  try {
    const user = JSON.parse(storage.getItem('currentUser') || 'null');
    if (!isAffiliationActive(user?.campusAffiliation)) return null;
    return user.campusAffiliation.collegeId ?? user.collegeId ?? null;
  } catch {
    return null;
  }
}

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

  /** The stored value if it may be painted for `userId` (and, for Campus, their college), else null. */
  const usable = (value, userId, spec) => {
    if (!value || value.v !== SNAPSHOT_VERSION || value.userId !== userId) return null;
    if (typeof value.savedAt !== 'number' || now() - value.savedAt > MAX_AGE_MS) return null;
    if (spec?.campus) {
      const scope = campusScope(storage);
      if (!scope || value.scope !== scope) return null;
    }
    return value;
  };

  const apply = (spec, value, userId) => {
    // Only into an empty slot: a network answer that landed during the read
    // is newer, and an account change meanwhile has emptied the cache.
    if (queryClient.getQueryData(spec.queryKey) !== undefined) return;
    if (currentUserId(storage) !== userId) return;
    if (!usable(value, userId, spec)) return;
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
    if (!userId || !usable(value, userId, spec)) return false;
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
          const value = usable(entry?.value, preloadUser, spec);
          if (!value || epoch !== idbEpoch()) return;
          syncEpoch();
          preloaded.set(hash, value);
        })
        .catch(() => {}); // a failed read-ahead just means the async path
    }
  }

  /** Serialises the index updates, which read, change and write one record. */
  let indexChain = Promise.resolve();

  /**
   * Notes `hash` as the most recently saved of its kind and deletes whatever
   * falls outside the newest `spec.max`, so the detail entries stay bounded.
   */
  const remember = (spec, userId, hash, epoch) => {
    const key = entryKey(userId, `index:${spec.name}`);
    indexChain = indexChain
      .then(async () => {
        if (epoch !== idbEpoch()) return;
        const entry = await idbGet('queries', key);
        const known = Array.isArray(entry?.value?.hashes) ? entry.value.hashes : [];
        const hashes = [hash, ...known.filter((h) => h !== hash)];
        for (const evicted of hashes.slice(spec.max)) await idbDelete('queries', entryKey(userId, evicted));
        await idbSet('queries', key, { v: SNAPSHOT_VERSION, userId, hashes: hashes.slice(0, spec.max) }, epoch);
      })
      .catch(() => {}); // a missed index only means one entry outlives the cap until the next save
  };

  const save = (hash, epoch) => {
    // Scheduled before a sign-out: the state it would touch is the next account's.
    if (epoch !== idbEpoch()) return;
    pendingWrites.delete(hash);
    // Looked up again at idle time: a sign-out in between has removed it.
    const query = queryClient.getQueryCache().get(hash);
    const spec = query && specFor(query.queryKey, hash);
    const userId = currentUserId(storage);
    if (!spec || !userId || query.state.status !== 'success') return;
    const data = spec.trim(query.state.data);
    if (data === undefined) return;
    const scope = spec.campus ? campusScope(storage) : undefined;
    // Campus content of an account that no longer has a campus is not kept.
    if (spec.campus && !scope) return;
    lastWrite.set(hash, now());
    void idbSet(
      'queries',
      entryKey(userId, hash),
      { v: SNAPSHOT_VERSION, userId, savedAt: query.state.dataUpdatedAt || now(), data, ...(scope ? { scope } : {}) },
      epoch,
    );
    if (spec.max) remember(spec, userId, hash, epoch);
  };

  return queryClient.getQueryCache().subscribe((event) => {
    const query = event?.query;
    const spec = query && specFor(query.queryKey, query.queryHash);
    if (!spec) return;

    if (event.type === 'observerAdded') {
      if (query.state.data === undefined && !restoreNow(query, spec)) void restore(query, spec);
      return;
    }

    // The server refused this record (an activity made private, a community
    // taken down): what is on disk for it must not outlive the answer.
    if (event.type === 'updated' && event.action?.type === 'error' && spec.max) {
      const status = query.state.error?.status ?? query.state.error?.response?.status;
      const userId = currentUserId(storage);
      if ((status === 403 || status === 404) && userId) void idbDelete('queries', entryKey(userId, query.queryHash));
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
