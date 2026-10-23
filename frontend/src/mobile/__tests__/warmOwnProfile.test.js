// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const idb = { get: vi.fn(), epoch: 0 };
vi.mock('../../shared/lib/idb', () => ({
  idbGet: (...args) => idb.get(...args),
  idbEpoch: () => idb.epoch,
}));
const warmCover = vi.fn();
vi.mock('../../shared/components/ui/CoverImage', () => ({ warmCover: (...a) => warmCover(...a) }));
vi.mock('../../shared/api/apiClient', () => ({ whenSessionReady: async () => {}, mayHaveCookieSession: () => false }));
vi.mock('../../features/feed/utils/feedQuery', () => ({ feedQueryOptions: () => ({ queryKey: ['feed'] }) }));
vi.mock('../feedSnapshot', () => ({ restoreFeedSnapshot: () => false, persistFeedSnapshot: () => () => {} }));

const { warmOwnProfile } = await import('../warmSignedInLanding');
const { PROFILE_KEYS } = await import('../../shared/hooks/useProfile.js');

const USER = { id: 'u1', username: 'Sarthak' };
const stored = (extra = {}) => ({
  value: { id: 'u1', username: 'Sarthak', stats: { posts: 1 }, cover: 'covers/c.webp', ...extra },
  storedAt: 1_000,
  isStale: false,
});
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('warmOwnProfile', () => {
  beforeEach(() => {
    idb.get.mockReset();
    idb.epoch = 0;
    warmCover.mockReset();
    window.requestIdleCallback = (fn) => setTimeout(fn, 0);
  });

  it('seeds the profile the Profile tab will ask for, marked as old as it is', async () => {
    idb.get.mockResolvedValue(stored());
    const qc = new QueryClient();
    warmOwnProfile(qc, USER);
    await settle();
    expect(idb.get).toHaveBeenCalledWith('profiles', 'sarthak');
    expect(qc.getQueryData(['profile', 'sarthak'])?.stats).toEqual({ posts: 1 });
    // Kept at the time it was saved, so it still counts as stale and is refetched.
    expect(qc.getQueryState(['profile', 'sarthak']).dataUpdatedAt).toBe(1_000);
    expect(warmCover).toHaveBeenCalledWith('covers/c.webp');
  });

  it('uses the same key as the profile hook', () => {
    expect(PROFILE_KEYS.byUsername('Sarthak')).toEqual(['profile', 'sarthak']);
  });

  it('skips an incomplete entry, which the screen would refetch anyway', async () => {
    idb.get.mockResolvedValue(stored({ stats: undefined }));
    const qc = new QueryClient();
    warmOwnProfile(qc, USER);
    await settle();
    expect(qc.getQueryData(['profile', 'sarthak'])).toBeUndefined();
  });

  it('never seeds another account\'s profile', async () => {
    idb.get.mockResolvedValue(stored({ id: 'someone-else' }));
    const qc = new QueryClient();
    warmOwnProfile(qc, USER);
    await settle();
    expect(qc.getQueryData(['profile', 'sarthak'])).toBeUndefined();
  });

  it('leaves a newer network answer alone', async () => {
    idb.get.mockResolvedValue(stored());
    const qc = new QueryClient();
    qc.setQueryData(['profile', 'sarthak'], { id: 'u1', stats: { posts: 9 } });
    warmOwnProfile(qc, USER);
    await settle();
    expect(qc.getQueryData(['profile', 'sarthak']).stats).toEqual({ posts: 9 });
  });

  it('drops the read when the cache was cleared meanwhile (sign-out)', async () => {
    idb.get.mockImplementation(async () => { idb.epoch += 1; return stored(); });
    const qc = new QueryClient();
    warmOwnProfile(qc, USER);
    await settle();
    expect(qc.getQueryData(['profile', 'sarthak'])).toBeUndefined();
  });

  it('does nothing without a user to key on', async () => {
    const qc = new QueryClient();
    warmOwnProfile(qc, null);
    warmOwnProfile(qc, { id: 'u1' });
    await settle();
    expect(idb.get).not.toHaveBeenCalled();
  });
});
