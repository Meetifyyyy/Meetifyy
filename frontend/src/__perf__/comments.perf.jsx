import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createRecorder, Profiled } from './profiler.jsx';
import { makeComments, makePost, CURRENT_USER, COMMUNITIES } from './fixtures.js';

const calls = { getPostById: 0, getComments: 0, addComment: 0, likeComment: 0 };
const POST = makePost(1);
const COMMENTS = makeComments(12, 3); // 12 roots x (3 replies + 1 grandchild) = 60 nodes

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) } },
  isSupabaseConfigured: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => (typeof u === 'string' ? u : ''),
  postsApi: {
    getPostById: async () => { calls.getPostById++; return { ...POST, comments: COMMENTS, commentsNextCursor: null }; },
    getComments: async () => { calls.getComments++; return { comments: [], nextCursor: null }; },
    addComment: async () => { calls.addComment++; return { id: `new-${calls.addComment}`, text: 'new', parentId: null, author: CURRENT_USER, authorId: 'me', createdAt: new Date().toISOString(), likeCount: 0 }; },
    likeComment: async () => { calls.likeComment++; return {}; },
    unlikeComment: async () => ({}),
    deleteComment: async () => ({}),
    likePost: async () => ({}), unlikePost: async () => ({}),
    bookmarkPost: async () => ({}), unbookmarkPost: async () => ({}),
    deletePost: async () => ({}), votePoll: async () => ({}),
  },
  communitiesApi: { getAll: async () => COMMUNITIES, getCampusCommunities: async () => [] },
  reportsApi: { create: async () => ({}) },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: CURRENT_USER, isLoggedIn: true, loading: false }),
  AuthProvider: ({ children }) => children,
}));
vi.mock('@shared/lib/idb', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));
vi.mock('@stores/useGlobalSocketStore', () => ({ useGlobalSocketStore: () => ({ socket: null, isConnected: false }) }));

// CommentTreeRoot and CommentNode live in the SAME module, so mocking that
// module cannot intercept the internal recursion. RichText is rendered once per
// comment body from a separate module, so counting it counts real node renders.
const nodeRenders = { n: 0 };
vi.mock('@shared/components/mentions/RichText', async (importOriginal) => {
  const mod = await importOriginal();
  const Real = mod.default;
  const Counting = (props) => { nodeRenders.n++; return <Real {...props} />; };
  return { ...mod, default: Counting };
});
// How many ReportModal instances get mounted across the tree?
const reportModalRenders = { n: 0 };
vi.mock('@shared/components/modals/ReportModal/ReportModal', async (importOriginal) => {
  const mod = await importOriginal();
  const Real = mod.default;
  const Counting = (props) => { reportModalRenders.n++; return <Real {...props} />; };
  return { ...mod, default: Counting };
});

const { default: PostView } = await import('@features/feed/components/post/PostView');
const { MediaViewerProvider } = await import('@shared/context/MediaViewerContext');

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const settle = async (ms = 60) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

describe('Post View comments', () => {
  const zero = () => { nodeRenders.n = 0; reportModalRenders.n = 0; };
  beforeEach(() => { zero(); Object.keys(calls).forEach(k => calls[k] = 0); });

  it('measures a 60-node thread and single-comment interactions', async () => {
    const recorder = createRecorder();
    render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter>
          <MediaViewerProvider>
            <Profiled id="postview" recorder={recorder}>
              <PostView post={POST} onBack={() => {}} />
            </Profiled>
          </MediaViewerProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await settle(200);

    console.log('\n[OPEN POST VIEW, 60 comments]', JSON.stringify({
      totalComments: COMMENTS.length,
      commentBodyRenders: nodeRenders.n,
      reportModalInstances: reportModalRenders.n,
      commits: recorder.get('postview').mounts + recorder.get('postview').updates,
      actualMs: +recorder.get('postview').actual.toFixed(2),
      postFetches: calls.getPostById,
    }));

    // ── Like ONE comment ──
    zero(); recorder.reset();
    // The first action button inside the first comment card is Like.
    const firstCard = document.querySelector('[data-comment-card]');
    const firstLike = firstCard.querySelectorAll('button')[2] || firstCard.querySelector('button');
    await act(async () => { firstLike.click(); });
    await settle(40);
    console.log('[LIKE 1 COMMENT]', JSON.stringify({
      commentBodiesReRendered: nodeRenders.n,
      actualMs: +recorder.get('postview').actual.toFixed(2),
    }));

    // ── Open ONE comment's reply box ──
    zero(); recorder.reset();
    const replyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Reply');
    await act(async () => { replyBtn.click(); });
    await settle(40);
    console.log('[OPEN 1 REPLY BOX]', JSON.stringify({
      commentBodiesReRendered: nodeRenders.n,
      actualMs: +recorder.get('postview').actual.toFixed(2),
    }));

    expect(nodeRenders.n).toBeGreaterThanOrEqual(0);
  });
});
