/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MediaViewerProvider } from '@shared/context/MediaViewerContext';

globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
};
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

const CURRENT_USER = { id: 'me', username: 'me', displayName: 'Me' };

vi.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}),
    },
  },
  isSupabaseConfigured: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => (typeof u === 'string' ? u : ''),
  postsApi: {
    likePost: async () => ({}),
    unlikePost: async () => ({}),
    bookmarkPost: async () => ({}),
    unbookmarkPost: async () => ({}),
    deletePost: async () => ({}),
    votePoll: async () => ({}),
  },
  communitiesApi: { getAll: async () => [], getCampusCommunities: async () => [] },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: CURRENT_USER, isLoggedIn: true, loading: false }),
}));
vi.mock('@shared/lib/idb', () => ({
  idbGet: async () => null,
  idbSet: async () => {},
  idbDelete: async () => {},
}));

const { default: VirtualFeedList } = await import('../VirtualFeedList');

const LONG_TEXT = 'Line of text that will be long enough to truncate. '.repeat(15);

function makePost(id, text = LONG_TEXT) {
  return {
    id,
    authorId: 'u1',
    author: { id: 'u1', displayName: 'Author', username: 'author', avatar: null },
    text,
    createdAt: new Date().toISOString(),
    media: [],
    likeCount: 0,
    commentCount: 0,
    hasLiked: false,
    hasBookmarked: false,
  };
}

function renderVirtualFeedList(posts) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MediaViewerProvider>
        <MemoryRouter>
          <VirtualFeedList posts={posts} />
        </MemoryRouter>
      </MediaViewerProvider>
    </QueryClientProvider>
  );
}

describe('VirtualFeedList viewport scroll stability', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders container with overflow-anchor: none to prevent browser scroll anchoring interference', () => {
    const posts = [makePost('p1')];
    const { container } = renderVirtualFeedList(posts);

    const listContainer = container.firstElementChild;
    expect(listContainer).toBeTruthy();
    expect(listContainer.style.overflowAnchor).toBe('none');
  });

  it('allows expanding and collapsing a post without calling window.scrollTo', () => {
    const posts = [makePost('p1')];
    renderVirtualFeedList(posts);

    const initialCalls = window.scrollTo.mock.calls.length;

    const seeMoreBtn = screen.getByRole('button', { name: /see more/i });
    expect(seeMoreBtn).toBeTruthy();

    // Click "See more"
    fireEvent.click(seeMoreBtn);

    // Button should now read "See less"
    const seeLessBtn = screen.getByRole('button', { name: /see less/i });
    expect(seeLessBtn).toBeTruthy();

    // Click "See less"
    fireEvent.click(seeLessBtn);
    expect(screen.getByRole('button', { name: /see more/i })).toBeTruthy();

    // During expand and collapse, window.scrollTo must NOT be called
    expect(window.scrollTo.mock.calls.length).toBe(initialCalls);
  });

  it('verifies that expanding and collapsing multiple posts in succession causes zero scroll calls or drift', () => {
    const posts = [makePost('p1'), makePost('p2')];
    renderVirtualFeedList(posts);

    const initialCalls = window.scrollTo.mock.calls.length;

    // Both posts have "See more"
    const seeMoreButtons = screen.getAllByRole('button', { name: /see more/i });
    expect(seeMoreButtons.length).toBe(2);

    // Expand post 1
    fireEvent.click(seeMoreButtons[0]);
    // Expand post 2
    fireEvent.click(seeMoreButtons[1]);

    // Both should now be expanded
    const seeLessButtons = screen.getAllByRole('button', { name: /see less/i });
    expect(seeLessButtons.length).toBe(2);

    // Collapse post 1
    fireEvent.click(seeLessButtons[0]);
    // Collapse post 2
    fireEvent.click(seeLessButtons[1]);

    // Both back to collapsed
    expect(screen.getAllByRole('button', { name: /see more/i }).length).toBe(2);

    // Cumulative scroll calls during all expands and collapses must be 0
    expect(window.scrollTo.mock.calls.length).toBe(initialCalls);
  });
});
