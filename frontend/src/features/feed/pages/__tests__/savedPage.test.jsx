/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  posts: {}, activities: {}, onIntersect: null,
  fetchPosts: vi.fn(), fetchActivities: vi.fn(), fetchIds: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: ({ queryKey }) => queryKey[0] === 'bookmarks' ? state.posts : state.activities,
  useQuery: () => ({ data: [] }),
}));
vi.mock('@shared/api/apiClient', () => ({ postsApi: {}, activitiesApi: {} }));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/stores/savedActivitiesStore', () => ({
  useSavedActivitiesStore: selector => selector({ savedActivities: [], fetchSavedActivityIds: state.fetchIds }),
}));
vi.mock('../../components/post/Post', () => ({ default: ({ postData }) => <div>{postData.text}</div> }));
vi.mock('@features/crew/components/cards/CrewCard', () => ({ default: ({ activity }) => <div>{activity.title}</div> }));
vi.mock('@features/crew/components/cards/CrewCardSkeleton', () => ({ default: () => <div>Loading</div> }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <div /> }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.onIntersect = null;
  state.posts = {
    data: { pages: [{ posts: [{ id: 'p1', text: 'Saved post' }] }] },
    fetchNextPage: state.fetchPosts, hasNextPage: true,
    isLoading: false, isFetchingNextPage: false,
  };
  state.activities = {
    data: { pages: [{ activities: [{ id: 'a1', title: 'Saved activity' }] }] },
    fetchNextPage: state.fetchActivities, hasNextPage: true,
    isLoading: false, isFetchingNextPage: false,
  };
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { state.onIntersect = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const { default: SavedPage } = await import('../SavedPage');
const showPage = () => render(<MemoryRouter><SavedPage /></MemoryRouter>);

describe('Saved page without category filters', () => {
  it('shows both kinds of saved content without category buttons', () => {
    showPage();
    expect(screen.getByText('Saved post')).toBeTruthy();
    expect(screen.getByText('Saved activity')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Activities|Posts/ })).toBeNull();
    expect(screen.getByTitle('Compact View')).toBeTruthy();
  });

  it('loads the next page of both lists when the sentinel becomes visible', () => {
    showPage();
    state.onIntersect([{ isIntersecting: false }]);
    expect(state.fetchPosts).not.toHaveBeenCalled();
    state.onIntersect([{ isIntersecting: true }]);
    expect(state.fetchPosts).toHaveBeenCalledTimes(1);
    expect(state.fetchActivities).toHaveBeenCalledTimes(1);
  });

  it('keeps paginating activities while posts are already fetching', () => {
    state.posts.isFetchingNextPage = true;
    showPage();
    state.onIntersect([{ isIntersecting: true }]);
    expect(state.fetchPosts).not.toHaveBeenCalled();
    expect(state.fetchActivities).toHaveBeenCalledTimes(1);
  });

  it('shows one empty state when both lists are empty', () => {
    state.posts.data.pages[0].posts = [];
    state.activities.data.pages[0].activities = [];
    state.posts.hasNextPage = false;
    state.activities.hasNextPage = false;
    showPage();
    expect(screen.getByRole('heading', { name: 'Nothing saved yet' })).toBeTruthy();
    expect(screen.queryByTitle('Compact View')).toBeNull();
    expect(state.onIntersect).toBeNull();
  });
});
