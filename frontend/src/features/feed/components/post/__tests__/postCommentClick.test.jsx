/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

afterEach(() => {
  cleanup();
});

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

vi.mock('@shared/lib/supabase', () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) } }, isSupabaseConfigured: false }));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => u,
  postsApi: {
    getPostById: async () => ({
      id: 'p1',
      text: 'Test post',
      authorId: 'u1',
      author: { id: 'u1', displayName: 'User 1', username: 'user1' },
      createdAt: new Date().toISOString(),
      comments: [],
    }),
    getComments: async () => ({ comments: [], nextCursor: null }),
  },
  communitiesApi: { getAll: async () => [], getCampusCommunities: async () => [] },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me', displayName: 'Me', username: 'me' }, isLoggedIn: true, loading: false }) }));
vi.mock('@shared/lib/idb', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));
vi.mock('@stores/useGlobalSocketStore', () => ({ useGlobalSocketStore: () => ({ socket: null, isConnected: false }) }));

const { default: Post } = await import('@features/feed/components/post/Post');
const { default: PostView } = await import('@features/feed/components/post/PostView');
const { MediaViewerProvider } = await import('@shared/context/MediaViewerContext');

const samplePost = {
  id: 'p1',
  authorId: 'u1',
  author: { id: 'u1', displayName: 'User 1', username: 'user1' },
  text: 'Hello world',
  createdAt: new Date().toISOString(),
  media: [],
  commentCount: 2,
};

describe('Comment button click behavior on post card and post view', () => {
  it('calls onCommentClick when comment button is clicked on Post', () => {
    const onCommentClick = vi.fn();
    const onClick = vi.fn();

    const { getByLabelText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <MediaViewerProvider>
            <Post postData={samplePost} onClick={onClick} onCommentClick={onCommentClick} />
          </MediaViewerProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const commentBtn = getByLabelText('Comment on post');
    fireEvent.click(commentBtn);

    expect(onCommentClick).toHaveBeenCalledTimes(1);
    expect(onCommentClick).toHaveBeenCalledWith(samplePost, expect.anything());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('falls back to onClick with focusComment: true when onCommentClick is not provided', () => {
    const onClick = vi.fn();

    const { getByLabelText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <MediaViewerProvider>
            <Post postData={samplePost} onClick={onClick} />
          </MediaViewerProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const commentBtn = getByLabelText('Comment on post');
    fireEvent.click(commentBtn);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(samplePost, { focusComment: true });
  });

  it('redirects focus to comment input when PostView opens with autoFocusComment or state.focusComment', async () => {
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/post/p1', state: { post: samplePost, focusComment: true } }]}>
          <MediaViewerProvider>
            <PostView post={samplePost} onBack={() => {}} />
          </MediaViewerProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      const editor = container.querySelector('[contenteditable="true"]');
      expect(editor).toBeTruthy();
      expect(document.activeElement).toBe(editor);
    });
  });

  it('focuses composer when comment button inside PostView is clicked', async () => {
    const queryClient = new QueryClient();

    const { container, getByLabelText } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/post/p1', state: { post: samplePost } }]}>
          <MediaViewerProvider>
            <PostView post={samplePost} onBack={() => {}} />
          </MediaViewerProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const commentBtn = getByLabelText('Comment on post');
    fireEvent.click(commentBtn);

    await waitFor(() => {
      const editor = container.querySelector('[contenteditable="true"]');
      expect(editor).toBeTruthy();
      expect(document.activeElement).toBe(editor);
    });
  });
});
