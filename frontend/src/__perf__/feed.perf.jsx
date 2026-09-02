import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createRecorder, Profiled } from './profiler.jsx';
import { makeFeedPage, CURRENT_USER, COMMUNITIES } from './fixtures.js';

// ── Network layer: deterministic, counted ────────────────────────────────────
const calls = { getFeed: 0, likePost: 0, bookmarkPost: 0, unbookmarkPost: 0, votePoll: 0, getPostById: 0, getComments: 0 };

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
  } },
  isSupabaseConfigured: false,
}));

vi.mock('@shared/api/apiClient', async () => {
  return {
    getMediaUrl: (u) => (typeof u === 'string' ? u : ''),
    postsApi: {
      getFeed: async (limit, cursor) => { calls.getFeed++; const idx = cursor ? Number(String(cursor).split('-')[1]) : 0; return makeFeedPage(idx); },
      getPostById: async (id) => { calls.getPostById++; return null; },
      getComments: async () => { calls.getComments++; return { comments: [], nextCursor: null }; },
      likePost: async () => { calls.likePost++; return {}; },
      unlikePost: async () => ({}),
      bookmarkPost: async () => { calls.bookmarkPost++; return {}; },
      unbookmarkPost: async () => { calls.unbookmarkPost++; return {}; },
      createPost: async (p) => ({ id: 'new', ...p }),
      deletePost: async () => ({}),
      votePoll: async () => { calls.votePoll++; return {}; },
      addComment: async () => ({}),
      deleteComment: async () => ({}),
      likeComment: async () => ({}),
      unlikeComment: async () => ({}),
    },
    communitiesApi: { getAll: async () => COMMUNITIES, getCampusCommunities: async () => [] },
  };
});

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: CURRENT_USER, isLoggedIn: true, loading: false, username: 'me', displayName: 'Me' }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('@shared/lib/idb', () => ({
  idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {},
}));

// Counting the OUTER Post would count the memo wrapper, which renders even
// when the memo bails. PostActions and MediaGrid live INSIDE Post's memo
// boundary, so they render only when Post itself genuinely re-rendered.
const postRenders = { n: 0 };
const actionRenders = { n: 0 };
const mediaRenders = { n: 0 };
vi.mock('@features/feed/components/post/Post', async (importOriginal) => {
  const mod = await importOriginal();
  const Real = mod.default;
  const Counting = (props) => { postRenders.n++; return <Real {...props} />; };
  return { ...mod, default: Counting };
});
vi.mock('@features/feed/components/post/PostActions', async (importOriginal) => {
  const mod = await importOriginal();
  const Real = mod.default;
  const Counting = (props) => { actionRenders.n++; return <Real {...props} />; };
  return { ...mod, default: Counting };
});
vi.mock('@features/feed/components/post/MediaGrid', async (importOriginal) => {
  const mod = await importOriginal();
  const Real = mod.default;
  const Counting = (props) => { mediaRenders.n++; return <Real {...props} />; };
  return { ...mod, default: Counting };
});

const { default: Feed } = await import('@features/feed/components/Feed');
const { MediaViewerProvider, useMediaViewer } = await import('@shared/context/MediaViewerContext');

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

// Reaches into the MediaViewer context so the test can open the viewer the
// same way a media tap does.
const viewerHandle = { open: () => {} };
function ViewerProbe() {
  const v = useMediaViewer();
  viewerHandle.open = () => v.openViewer([{ url: '/api/media/x', type: 'image' }], 0, null);
  return null;
}

function Harness({ recorder, client }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MediaViewerProvider>
          <ViewerProbe />
          <Profiled id="feed" recorder={recorder}>
            <Feed onPostClick={() => {}} />
          </Profiled>
        </MediaViewerProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function settle(ms = 50) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe('Home feed', () => {
  const zero = () => { postRenders.n = 0; actionRenders.n = 0; mediaRenders.n = 0; };
  beforeEach(() => { zero(); Object.keys(calls).forEach(k => calls[k] = 0); });

  it('measures initial load + a like on one post', async () => {
    const recorder = createRecorder();
    const client = makeClient();
    render(<Harness recorder={recorder} client={client} />);
    await settle(120);

    const mount = { postRenders: postRenders.n, ...recorder.get('feed') };
    console.log('\n[INITIAL LOAD]', JSON.stringify({
      postBodyRenders: mount.postRenders,
      postInnerRenders: actionRenders.n,
      feedCommits: mount.mounts + mount.updates,
      feedActualMs: +mount.actual.toFixed(2),
      getFeedRequests: calls.getFeed,
    }));

    // ── Like ONE post: how many Post components re-render? ──
    zero(); recorder.reset();
    const likeButtons = screen.getAllByLabelText('Like post');
    await act(async () => { likeButtons[0].click(); });
    await settle(30);
    console.log('[LIKE 1 POST]', JSON.stringify({
      postsThatActuallyReRendered: actionRenders.n,
      mediaGridReRenders: mediaRenders.n,
      memoWrapperRenders: postRenders.n,
      feedCommits: recorder.get('feed').mounts + recorder.get('feed').updates,
      feedActualMs: +recorder.get('feed').actual.toFixed(2),
    }));

    // ── Save ONE post ──
    zero(); recorder.reset();
    const saveButtons = screen.getAllByLabelText('Save post');
    await act(async () => { saveButtons[0].click(); });
    await settle(30);
    console.log('[SAVE 1 POST]', JSON.stringify({
      postsThatActuallyReRendered: actionRenders.n,
      memoWrapperRenders: postRenders.n,
      feedActualMs: +recorder.get('feed').actual.toFixed(2),
    }));

    // ── Opening the media viewer: does it disturb the feed? ──
    zero(); recorder.reset();
    await act(async () => { viewerHandle.open(); });
    await settle(30);
    console.log('[OPEN MEDIA VIEWER]', JSON.stringify({
      postsThatActuallyReRendered: actionRenders.n,
      memoWrapperRenders: postRenders.n,
      feedActualMs: +recorder.get('feed').actual.toFixed(2),
    }));

    expect(mount.postRenders).toBeGreaterThan(0);
  });
});
