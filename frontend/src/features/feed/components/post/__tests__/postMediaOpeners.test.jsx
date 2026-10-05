/**
 * @vitest-environment jsdom
 *
 * Scoped to this file rather than switched on project-wide: the rest of the
 * suite is node-environment and does not need a DOM.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Opening a post's media: each tile is a named button, and the viewer is told
 * what a report from it should target.
 */

const openViewer = vi.fn();
vi.mock('@shared/context/MediaViewerContext', () => ({
  useMediaViewerActions: () => ({ openViewer }),
}));

// Browser APIs the post subtree touches on mount, which jsdom does not provide.
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

const CURRENT_USER = { id: 'me', username: 'me', displayName: 'Me' };

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
  } },
  isSupabaseConfigured: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads these to decide whether
  // a cookie session is worth recovering, and to carry the CSRF token the
  // server returns in the body of every session-issuing response.
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: {
    currentSession: async () => ({ user: null }),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
  getMediaUrl: (u) => (typeof u === 'string' ? u : ''),
  postsApi: {
    likePost: async () => ({}), unlikePost: async () => ({}),
    bookmarkPost: async () => ({}), unbookmarkPost: async () => ({}),
    deletePost: async () => ({}), votePoll: async () => ({}),
  },
  communitiesApi: { getAll: async () => [], getCampusCommunities: async () => [] },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: CURRENT_USER, isLoggedIn: true, loading: false }),
}));
vi.mock('@shared/lib/idb', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));

const { default: Post } = await import('@features/feed/components/post/Post');

const GALLERY = [
  { url: '/api/media/a', type: 'image', width: 800, height: 800, aspectRatio: 1 },
  { url: '/api/media/b', type: 'image', width: 800, height: 800, aspectRatio: 1 },
  { url: '/api/media/c', type: 'video', width: 800, height: 800, aspectRatio: 1 },
];

function makePost(overrides = {}) {
  return {
    id: 'p1',
    authorId: 'u1',
    author: { id: 'u1', displayName: 'Author', username: 'author', avatar: null },
    text: 'caption',
    createdAt: new Date().toISOString(),
    media: GALLERY,
    likeCount: 0, commentCount: 0,
    hasLiked: false, hasBookmarked: false,
    ...overrides,
  };
}

function renderPost(post) {
  const utils = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Post postData={post} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return within(utils.container);
}

describe('post media openers', () => {
  afterEach(() => { cleanup(); openViewer.mockClear(); });

  it('exposes every tile as a button named by its kind, position and author', () => {
    const q = renderPost(makePost());
    expect(q.getByRole('button', { name: 'Open photo 1 of 3 by Author' })).toBeTruthy();
    expect(q.getByRole('button', { name: 'Open photo 2 of 3 by Author' })).toBeTruthy();
    expect(q.getByRole('button', { name: 'Open video 3 of 3 by Author' })).toBeTruthy();
  });

  it('opens the viewer on the right tile and says a report targets the post', () => {
    const q = renderPost(makePost());
    fireEvent.click(q.getByRole('button', { name: 'Open photo 2 of 3 by Author' }));
    expect(openViewer).toHaveBeenCalledTimes(1);
    const [items, index, meta] = openViewer.mock.calls[0];
    expect(items).toHaveLength(3);
    expect(index).toBe(1);
    expect(meta.report).toEqual({ targetType: 'POST', targetId: 'p1' });
    expect(meta.source).toBe('Post');
  });

  it('offers no report target on your own post', () => {
    const q = renderPost(makePost({ authorId: 'me', author: { id: 'me', displayName: 'Me', username: 'me' } }));
    fireEvent.click(q.getByRole('button', { name: 'Open photo 1 of 3 by Me' }));
    const [, , meta] = openViewer.mock.calls[0];
    expect(meta.isOwner).toBe(true);
    expect('report' in meta).toBe(false);
  });

  it('names a single photo without a position, and does not invent an author', () => {
    const q = renderPost(makePost({ media: [GALLERY[0]], author: undefined, authorId: 'u1' }));
    expect(q.getByRole('button', { name: 'Open photo' })).toBeTruthy();
  });
});
