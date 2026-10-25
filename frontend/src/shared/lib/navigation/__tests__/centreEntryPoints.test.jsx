/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

/**
 * Where in the app a page opens with the centre opening. Each of these taps a
 * real link with a driver installed (as the app has) and checks three things:
 * the open is asked for with the centre effect, the history entry is marked so
 * Back closes it the same way, and the state the page was already passing on
 * (`from`, which Back's fallback reads) is still there.
 */

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

vi.mock('@shared/hooks/useCommunities', () => ({
  useMyCommunities: () => ({
    myCommunities: [{ id: 'c1', name: 'Chess Club', memberCount: 4 }],
    isLoading: false,
    isError: false,
  }),
  useCommunities: () => ({ communities: [] }),
}));
vi.mock('@shared/lib/supabase', () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) } }, isSupabaseConfigured: false }));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: { currentSession: async () => ({ user: null }), adoptSession: async () => ({}), logoutSession: async () => ({}) },
  getMediaUrl: (u) => u,
  postsApi: {},
  communitiesApi: { getAll: async () => [], getCampusCommunities: async () => [] },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' }, isLoggedIn: true, loading: false }) }));
vi.mock('@shared/lib/idb', () => ({ idbEpoch: () => 0, bumpIdbEpoch: () => {}, idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));
vi.mock('@features/communities/components/directory/JoinAction', () => ({ default: () => null }));

const { setPageTransitionDriver, PAGE_TRANSITION_STATE_KEY } = await import('../pageTransition');
const { default: HomeCommunities } = await import('@features/communities/components/home/HomeCommunities');
const { default: CommunityRow } = await import('@features/communities/components/directory/CommunityRow');
const { default: Post } = await import('@features/feed/components/post/Post');
const { MediaViewerProvider } = await import('@shared/context/MediaViewerContext');

/** The app's driver, reduced to what these tests can see: it runs the navigation at once. */
const driver = { open: vi.fn((go) => go()), close: vi.fn() };

/** Shows where the router now is, and what state that entry carries. */
function Where() {
  const { pathname, search, state } = useLocation();
  return <output data-testid="where">{JSON.stringify({ at: pathname + search, state })}</output>;
}
const where = () => JSON.parse(screen.getByTestId('where').textContent);

const renderAt = (ui) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/home']}>
      <MediaViewerProvider>
        {ui}
        <Where />
      </MediaViewerProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

afterEach(() => {
  cleanup();
  setPageTransitionDriver(null);
  driver.open.mockClear();
});

describe('opened with the centre opening', () => {
  it("a community in Home's \"Your communities\", keeping where Back should fall back to", () => {
    setPageTransitionDriver(driver);
    renderAt(<HomeCommunities />);
    fireEvent.click(screen.getByTitle('Chess Club'));
    expect(driver.open).toHaveBeenCalledWith(expect.any(Function), { effect: 'centre' });
    expect(where()).toEqual({
      at: '/communities/c1',
      state: { from: '/home', [PAGE_TRANSITION_STATE_KEY]: 'centre' },
    });
  });

  it("\"See all\" in Home's \"Your communities\"", () => {
    setPageTransitionDriver(driver);
    renderAt(<HomeCommunities />);
    fireEvent.click(screen.getByText('See all'));
    expect(driver.open).toHaveBeenCalledWith(expect.any(Function), { effect: 'centre' });
    expect(where()).toEqual({ at: '/communities', state: { [PAGE_TRANSITION_STATE_KEY]: 'centre' } });
  });

  it('a community from the Communities or Campus communities list', () => {
    setPageTransitionDriver(driver);
    renderAt(<CommunityRow community={{ id: 'c9', name: 'Robotics', memberCount: 12 }} from="/campus/communities" />);
    fireEvent.click(screen.getByText('Robotics'));
    expect(driver.open).toHaveBeenCalledWith(expect.any(Function), { effect: 'centre' });
    expect(where()).toEqual({
      at: '/communities/c9',
      state: { from: '/campus/communities', [PAGE_TRANSITION_STATE_KEY]: 'centre' },
    });
  });

  it('the author of a post card, from the avatar and from the name', () => {
    setPageTransitionDriver(driver);
    const onPostClick = vi.fn();
    renderAt(
      <Post
        onClick={onPostClick}
        postData={{ id: 'p', authorId: 'u', author: { id: 'u', displayName: 'Asha', username: 'asha' }, text: 'hello', createdAt: new Date().toISOString(), media: [] }}
      />,
    );
    const [avatarLink, nameLink] = [...document.querySelectorAll('a[href="/profile/asha"]')];
    for (const link of [avatarLink, nameLink]) {
      fireEvent.click(link);
      expect(driver.open).toHaveBeenLastCalledWith(expect.any(Function), { effect: 'centre' });
      expect(where()).toEqual({ at: '/profile/asha', state: { [PAGE_TRANSITION_STATE_KEY]: 'centre' } });
    }
    // Tapping the author is not tapping the post.
    expect(onPostClick).not.toHaveBeenCalled();
  });
});

describe('on the website, where there is no driver', () => {
  it('the links are plain links and nothing is marked', () => {
    renderAt(<HomeCommunities />);
    fireEvent.click(screen.getByTitle('Chess Club'));
    expect(driver.open).not.toHaveBeenCalled();
    expect(where()).toEqual({ at: '/communities/c1', state: { from: '/home' } });
  });
});
