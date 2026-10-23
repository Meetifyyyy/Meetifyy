/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * A community opened with no network: shown when the device has it (its own
 * saved record, or a row from a list), a centred offline state with a way back
 * when it has nothing, never a skeleton that never ends or "not found", and
 * actions that need the network refused with the reason.
 */
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.scrollIntoView = function () {};

const { community, join, showToast } = vi.hoisted(() => ({
  community: { value: {} },
  join: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@shared/lib/supabase', () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) } }, isSupabaseConfigured: false }));
vi.mock('@shared/api/apiClient', () => ({
  deriveThumbnailKey: () => null,
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: { currentSession: async () => ({ user: null }), adoptSession: async () => ({}), logoutSession: async () => ({}) },
  getMediaUrl: (u) => u,
  postsApi: { getFeed: vi.fn(async () => ({ posts: [], nextCursor: null })) },
  communitiesApi: { join, delete: vi.fn(), acknowledgeModeratorNotice: vi.fn() },
  uploadsApi: {},
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'me', displayName: 'Me', username: 'me', verificationStatus: 'VERIFIED' },
    isLoggedIn: true,
    loading: false,
  }),
}));
vi.mock('@shared/lib/idb', () => ({ idbEpoch: () => 0, bumpIdbEpoch: () => {}, idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));
vi.mock('@stores/useGlobalSocketStore', () => ({ useGlobalSocketStore: (sel) => { const st = { socket: null, isConnected: false }; return sel ? sel(st) : st; } }));
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({}) }));
vi.mock('@shared/hooks/useCommunities', () => ({
  useCommunities: () => ({ communitiesById: {} }),
  useCommunityById: () => community.value,
}));
vi.mock('@shared/hooks/useCommunityActions', () => ({
  useCommunityActions: () => ({ addPost: vi.fn(), updateCommunity: vi.fn() }),
}));
vi.mock('@shared/utils/toast', () => ({ showToast }));

const { default: CommunityView } = await import('../components/view/CommunityView');
const { MediaViewerProvider } = await import('@shared/context/MediaViewerContext');

const FULL = {
  id: 'c1',
  name: 'Chess Club',
  memberCount: 12,
  isJoined: false,
  canViewPosts: true,
  allowMemberPosts: true,
};

let onLine;
const renderView = (onBack = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MediaViewerProvider>
          <CommunityView communityId="c1" onBack={onBack} />
        </MediaViewerProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onBack };
};

beforeEach(() => {
  onLine = false;
  onlineManager.setOnline(false);
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  join.mockReset();
  showToast.mockReset();
});
afterEach(() => {
  onlineManager.setOnline(true);
  cleanup();
  vi.restoreAllMocks();
});

describe('community opened offline', () => {
  it('with nothing available: a centred offline state and a way back, not a skeleton or "not found"', () => {
    // A paused query: no data, not loading, not an error.
    community.value = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    const { container, onBack } = renderView();

    expect(container.querySelector('[data-offline-screen]')).not.toBeNull();
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.queryByText(/community not found/i)).toBeNull();
    expect(container.querySelector('[class*="skeleton" i]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('with the community available (its own copy or a list row): shows it, no offline screen', () => {
    community.value = { data: FULL, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    const { container } = renderView();
    expect(container.querySelector('[data-offline-screen]')).toBeNull();
    expect(screen.getAllByText('Chess Club').length).toBeGreaterThan(0);
  });

  it('with the community but no posts on the device: says so rather than showing a skeleton forever', async () => {
    community.value = { data: FULL, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    renderView();
    expect(await screen.findByText('Connect to the internet to see the posts.')).toBeTruthy();
  });

  it('refuses a network-only action (Join) with the offline sentence and makes no request', () => {
    community.value = { data: FULL, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    renderView();
    fireEvent.click(screen.getAllByRole('button', { name: /^join$/i })[0]);
    expect(join).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalled();
    expect(showToast.mock.calls[0][0]).toMatch(/offline/i);
  });

  it('a community the server says is gone is still "not found", offline or not', () => {
    community.value = {
      data: undefined, isLoading: false, isError: true,
      error: Object.assign(new Error('gone'), { response: { status: 404 } }), refetch: vi.fn(),
    };
    renderView();
    expect(screen.getByText(/community not found/i)).toBeTruthy();
  });
});
