import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeIndexedDB } from './helpers/fakeIndexedDB';

/**
 * "Clear cached data" frees space without signing out and without losing a
 * message that has not been delivered.
 *
 * Everything that matters is asserted from the outside: what is left in
 * IndexedDB, Cache Storage and localStorage afterwards.
 */

const mediaCache = vi.hoisted(() => ({
  pendingRequests: new Map(),
  resolvers: [],
  batchQueue: new Set(),
  clear: vi.fn(),
  // The real manager's rule, over the fields above.
  isIdle() {
    return this.pendingRequests.size === 0 && this.resolvers.length === 0 && this.batchQueue.size === 0;
  },
}));
vi.mock('@shared/utils/MediaCacheManager', () => ({ mediaCache }));

function stubLocalStorage(initial) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  });
  return data;
}

function stubCaches(names) {
  const present = new Set(names);
  vi.stubGlobal('caches', {
    keys: async () => [...present],
    delete: async (n) => present.delete(n),
  });
  return present;
}

let fake;
let mod;
let idb;
let msgs;
let storage;
let cacheNames;
let queryClient;

const store = (db, name) => fake.db(db).stores.get(name).data;

beforeEach(async () => {
  fake = installFakeIndexedDB();
  mediaCache.clear.mockReset();
  mediaCache.pendingRequests.clear();
  mediaCache.resolvers.length = 0;
  mediaCache.batchQueue.clear();
  storage = stubLocalStorage({
    meetifyy_feed_snapshot_v1: '{"posts":[]}',
    'meetifyy_draft:v1:u1:post': '{"text":"half written"}',
    meetifyy_theme: 'dark',
    meetifyy_cookie_consent: 'acknowledged',
    currentUser: '{"id":"u1"}',
    loggedIn: 'true',
  });
  cacheNames = stubCaches(['meetifyy-images-v5', 'meetifyy-images-v3', 'meetifyy-api', 'workbox-precache-v2']);
  queryClient = { invalidateQueries: vi.fn(() => Promise.resolve()), clear: vi.fn() };

  vi.resetModules();
  idb = await import('../idb');
  msgs = await import('../../../features/messages/shared/utils/idbMessages');
  mod = await import('../clearCachedData');

  // Seed through the real code, then add the rows a mid-send chat would hold.
  await idb.idbSet('feed', 'home', [1]);
  await idb.idbSet('profiles', 'alice', { name: 'alice' });
  await idb.idbSet('queries', 'u1:feed', { page: 1 });
  await msgs.idbSaveMessages('c1', [
    { id: 'm1', text: 'old history', createdAt: '2026-01-01T00:00:00Z', status: 'sent' },
    { id: 'tmp_1', clientId: 'tmp_1', text: 'not sent yet', createdAt: '2026-01-02T00:00:00Z', status: 'sending', queued: true },
  ]);
  await msgs.idbSaveSyncMeta('c1', { nextCursor: 'x' });
  await msgs.idbOutboxPut({ clientId: 'tmp_1', userId: 'u1', conversationId: 'c1', payload: { text: 'not sent yet' } });
  await msgs.idbOutboxPut({ clientId: 'tmp_2', userId: 'u1', conversationId: 'c2', failed: true, payload: { text: 'tap to retry' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clearCachedData', () => {
  it('empties the IndexedDB cache, including the app query snapshots', async () => {
    const result = await mod.clearCachedData(queryClient);

    expect(result.ok).toBe(true);
    for (const name of ['feed', 'communities', 'activities', 'profiles', 'search', 'config', 'queries']) {
      expect(store('meetifyy_cache', name).size).toBe(0);
    }
  });

  it('keeps every unsent message: the whole outbox, and the rows that show it in the chat', async () => {
    await mod.clearCachedData(queryClient);

    expect([...store('meetifyy_messages', 'outbox').keys()].sort()).toEqual(['tmp_1', 'tmp_2']);
    expect((await msgs.idbOutboxAll('u1')).map((e) => e.payload.text).sort()).toEqual(['not sent yet', 'tap to retry']);
    expect([...store('meetifyy_messages', 'messages').keys()]).toEqual(['tmp_1']);
    expect(store('meetifyy_messages', 'sync_metadata').size).toBe(0);
  });

  it('does not start a new clear generation, which would make the outbox abandon in-flight sends', async () => {
    const epoch = idb.idbEpoch();
    await mod.clearCachedData(queryClient);
    expect(idb.idbEpoch()).toBe(epoch);
    // An outbox write begun before the clear still lands.
    expect(await msgs.idbOutboxPut({ clientId: 'late', userId: 'u1', conversationId: 'c1' }, epoch)).toBe(true);
  });

  it('removes only the service worker image caches', async () => {
    await mod.clearCachedData(queryClient);
    expect([...cacheNames].sort()).toEqual(['meetifyy-api', 'workbox-precache-v2']);
  });

  it('removes the saved feed page and nothing the person set or signed in with', async () => {
    await mod.clearCachedData(queryClient);
    expect([...storage.keys()].sort()).toEqual([
      'currentUser', 'loggedIn', 'meetifyy_cookie_consent', 'meetifyy_draft:v1:u1:post', 'meetifyy_theme',
    ]);
  });

  it('refetches what is on screen instead of emptying the query cache', async () => {
    await mod.clearCachedData(queryClient);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it('clears the signed media URLs when none is being signed', async () => {
    await mod.clearCachedData(queryClient);
    expect(mediaCache.clear).toHaveBeenCalledTimes(1);
  });

  it('leaves the signed media URLs alone while a request is in flight, so no image goes blank', async () => {
    mediaCache.pendingRequests.set('chat/a.jpg', Promise.resolve());
    const result = await mod.clearCachedData(queryClient);
    expect(mediaCache.clear).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('works without a query client, and where Cache Storage does not exist', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(mod.clearCachedData()).resolves.toMatchObject({ ok: true });
  });

  it('reports a step that failed, and still does the others', async () => {
    vi.stubGlobal('caches', { keys: async () => { throw new Error('denied'); }, delete: async () => true });
    const result = await mod.clearCachedData(queryClient);
    expect(result).toEqual({ ok: false, failed: ['imageCaches'] });
    expect(store('meetifyy_cache', 'feed').size).toBe(0);
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });
});

describe('estimateCacheUsage', () => {
  it('returns the origin usage in bytes', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 1234, quota: 99999 }) } });
    expect(await mod.estimateCacheUsage()).toBe(1234);
  });

  it('returns null where the browser cannot say', async () => {
    vi.stubGlobal('navigator', {});
    expect(await mod.estimateCacheUsage()).toBeNull();
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('no'); } } });
    expect(await mod.estimateCacheUsage()).toBeNull();
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } });
    expect(await mod.estimateCacheUsage()).toBeNull();
  });
});

describe('the feed snapshot key it clears', () => {
  it('is the key the app writes the snapshot under', async () => {
    const { FEED_SNAPSHOT_KEY } = await import('../../../mobile/feedSnapshot');
    const source = (await import('node:fs')).readFileSync(
      new URL('../clearCachedData.js', import.meta.url),
      'utf8',
    );
    expect(source).toContain(`'${FEED_SNAPSHOT_KEY}'`);
  });
});
