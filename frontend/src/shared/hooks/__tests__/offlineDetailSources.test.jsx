/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

/**
 * What a community or an activity opened with no network can still be built
 * from, and which actions refuse to run. The sources are the lists the person
 * has already seen (list rows stand in for the detail record) and the detail
 * query itself.
 */
const { getCommunity, getActivity, bookmark, showToast } = vi.hoisted(() => ({
  getCommunity: vi.fn(),
  getActivity: vi.fn(),
  bookmark: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('@shared/api/apiClient', () => ({
  communitiesApi: { getById: getCommunity },
  activitiesApi: { getById: getActivity, bookmark, unbookmark: bookmark },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ isLoggedIn: true }) }));
vi.mock('@shared/utils/toast', () => ({ showToast }));
vi.mock('@shared/lib/idb', () => ({
  idbGet: async () => null,
  idbSet: async () => {},
  idbDelete: async () => {},
  idbEpoch: () => 0,
}));

const { useCommunityById, findCommunityInListCaches } = await import('../useCommunities');
const { useActivityById } = await import('../useCrew');
const { useSavedActivitiesStore } = await import('../../stores/savedActivitiesStore');

let qc;
let onLine;
const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onLine = false;
  // What `installNetworkStatus` does in the app: queries pause with the UI.
  onlineManager.setOnline(false);
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  getCommunity.mockReset();
  getActivity.mockReset();
  bookmark.mockReset();
  showToast.mockReset();
});
afterEach(() => {
  onlineManager.setOnline(true);
  cleanup();
  qc.clear();
  vi.restoreAllMocks();
});

describe('community opened offline', () => {
  it('finds its row in whichever cached list holds it', () => {
    qc.setQueryData(['communities', 'mine'], [{ id: 'a' }, { id: 'b', name: 'Chess' }]);
    qc.setQueryData(['communities', 'explore', { search: '' }], { pages: [[{ id: 'c', name: 'Hiking' }]], pageParams: [0] });
    expect(findCommunityInListCaches(qc, 'b').name).toBe('Chess');
    expect(findCommunityInListCaches(qc, 'c').name).toBe('Hiking');
    expect(findCommunityInListCaches(qc, 'zzz')).toBeUndefined();
  });

  it('is built from that row, with no request made', () => {
    qc.setQueryData(['communities', 'mine'], [{ id: 'b', name: 'Chess' }]);
    const { result } = renderHook(() => useCommunityById('b'), { wrapper });
    expect(result.current.data.name).toBe('Chess');
    expect(result.current.isPlaceholderData).toBe(true);
    expect(getCommunity).not.toHaveBeenCalled();
  });

  it('prefers a full copy of its own over the list row', () => {
    qc.setQueryData(['communities', 'mine'], [{ id: 'b', name: 'Chess (row)' }]);
    qc.setQueryData(['community', 'b'], { id: 'b', name: 'Chess', rules: ['be kind'] });
    const { result } = renderHook(() => useCommunityById('b'), { wrapper });
    expect(result.current.data.rules).toEqual(['be kind']);
  });

  it('has nothing at all when no list has it either, and does not spin: the query is paused', () => {
    const { result } = renderHook(() => useCommunityById('nope'), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('paused');
    expect(result.current.isError).toBe(false);
  });

  it('online, the list row is not used as a stand-in for the full record', () => {
    onLine = true;
    onlineManager.setOnline(true);
    getCommunity.mockReturnValue(new Promise(() => {}));
    qc.setQueryData(['communities', 'mine'], [{ id: 'b', name: 'Chess' }]);
    const { result } = renderHook(() => useCommunityById('b'), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});

describe('activity opened offline', () => {
  it('is built from a list card, with no request made', () => {
    qc.setQueryData(['activities'], { pages: [{ activities: [{ id: 'a1', title: 'Hike' }] }], pageParams: [undefined] });
    const { result } = renderHook(() => useActivityById('a1'), { wrapper });
    expect(result.current.data.title).toBe('Hike');
    expect(getActivity).not.toHaveBeenCalled();
  });

  it('has nothing when no list or detail copy exists: paused, neither loading nor an error', () => {
    const { result } = renderHook(() => useActivityById('a1'), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.isAccessDenied).toBe(false);
  });
});

describe('save toggle (a network-only action)', () => {
  it('is refused offline with the offline sentence, and nothing is flipped', async () => {
    useSavedActivitiesStore.setState({ savedActivities: [] });
    await act(async () => { await useSavedActivitiesStore.getState().toggleSaveActivity('a1'); });
    expect(useSavedActivitiesStore.getState().savedActivities).toEqual([]);
    expect(bookmark).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toMatch(/offline/i);
  });

  it('works as before online', async () => {
    onLine = true;
    onlineManager.setOnline(true);
    bookmark.mockResolvedValue(undefined);
    useSavedActivitiesStore.setState({ savedActivities: [] });
    await act(async () => { await useSavedActivitiesStore.getState().toggleSaveActivity('a1'); });
    expect(useSavedActivitiesStore.getState().savedActivities).toEqual(['a1']);
    expect(showToast).not.toHaveBeenCalled();
  });
});
