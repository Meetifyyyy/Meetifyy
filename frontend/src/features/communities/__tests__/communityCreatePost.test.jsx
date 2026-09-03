/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

afterEach(() => {
  cleanup();
});

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

window.HTMLElement.prototype.scrollIntoView = function() {};

vi.mock('@shared/lib/supabase', () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}) } }, isSupabaseConfigured: false }));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => u,
  postsApi: {
    getFeed: async () => ({ posts: [], nextCursor: null }),
    getPostById: async () => null,
  },
  communitiesApi: {
    getAll: async () => [],
    getCampusCommunities: async () => [],
    getCommunityById: async () => ({
      id: 'comm1',
      name: 'Yes',
      memberCount: 1,
      isJoined: true,
      canViewPosts: true,
      allowMemberPosts: true,
    }),
    getCommunityPosts: async () => ({ posts: [] }),
    getModeratorNotice: async () => null,
  },
  uploadsApi: {},
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'me', displayName: 'Me', username: 'me', verificationStatus: 'VERIFIED' },
    isLoggedIn: true,
    loading: false,
  }),
}));
vi.mock('@shared/lib/idb', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {} }));
vi.mock('@stores/useGlobalSocketStore', () => ({ useGlobalSocketStore: () => ({ socket: null, isConnected: false }) }));
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({}) }));
vi.mock('@shared/hooks/useCommunities', () => ({
  useCommunities: () => ({ communitiesById: {} }),
  useCommunityById: (id) => ({
    data: {
      id: 'comm1',
      name: 'Yes',
      memberCount: 1,
      isJoined: true,
      canViewPosts: true,
      allowMemberPosts: true,
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@shared/hooks/useCommunityActions', () => ({
  useCommunityActions: () => ({
    addPost: vi.fn(),
    updateCommunity: vi.fn(),
  }),
}));
vi.mock('@shared/hooks/useJoinCommunity', () => ({
  useJoinCommunity: () => ({
    mutate: vi.fn(),
    isLoading: false,
  }),
}));

const { default: PostComposer } = await import('@features/feed/components/composer/PostComposer');
const { default: CommunityView } = await import('@features/communities/components/view/CommunityView');
const { MediaViewerProvider } = await import('@shared/context/MediaViewerContext');

describe('Create Post in Communities & PostComposer', () => {
  it('PostComposer focuses the contenteditable input when composer card is clicked', async () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PostComposer onSubmit={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const editor = container.querySelector('[contenteditable="true"]');
    expect(editor).toBeTruthy();

    const composerCard = editor.closest('div[class*="postComposer"]');
    expect(composerCard).toBeTruthy();
    fireEvent.click(composerCard);

    expect(document.activeElement).toBe(editor);
  });

  it('PostComposer exposes an imperative focus method that focuses the input', async () => {
    const composerRef = createRef();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PostComposer ref={composerRef} onSubmit={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const editor = container.querySelector('[contenteditable="true"]');
    expect(composerRef.current?.focus).toBeDefined();

    composerRef.current.focus();
    expect(document.activeElement).toBe(editor);
  });

  it('CommunityView focuses the post composer when Create Post button is clicked', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['community', 'comm1'], {
      id: 'comm1',
      name: 'Yes',
      memberCount: 1,
      isJoined: true,
      canViewPosts: true,
      allowMemberPosts: true,
    });
    queryClient.setQueryData(['communityPosts', 'comm1'], []);

    const { container, getAllByText } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MediaViewerProvider>
            <CommunityView communityId="comm1" onBack={() => {}} />
          </MediaViewerProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      const editor = container.querySelector('[contenteditable="true"]');
      expect(editor).toBeTruthy();
    });

    const createPostBtns = getAllByText('Create Post');
    expect(createPostBtns.length).toBeGreaterThan(0);

    fireEvent.click(createPostBtns[0]);

    await waitFor(() => {
      const editor = container.querySelector('[contenteditable="true"]');
      expect(document.activeElement).toBe(editor);
    });
  });
});
