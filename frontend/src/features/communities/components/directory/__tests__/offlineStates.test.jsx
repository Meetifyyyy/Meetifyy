/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const { mine, explore } = vi.hoisted(() => ({ mine: vi.fn(), explore: vi.fn() }));
vi.mock('@shared/hooks/useCommunities', () => ({
  useMyCommunities: mine,
  useExploreCommunities: explore,
}));
vi.mock('../CommunityRow', () => ({ default: ({ community }) => <li>{community.name}</li> }));
vi.mock('../CommunityRowSkeleton', () => ({ default: () => <div data-testid="skeleton" /> }));

import YourCommunities from '../YourCommunities';
import ExploreCommunities from '../ExploreCommunities';

let onLine;
beforeEach(() => {
  onLine = false;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const saved = [{ id: 'c1', name: 'Hiking Club' }, { id: 'c2', name: 'Chess' }];

/**
 * A screen opened offline shows what the device saved even when a refresh has
 * failed, and says "offline" (not an empty list, an error, or an endless
 * skeleton) when nothing was saved.
 */
describe('Communities offline', () => {
  it('Yours: saved communities stay on screen when the refresh failed; no error state', () => {
    mine.mockReturnValue({ myCommunities: saved, isLoading: false, isError: true, refetch: vi.fn() });
    render(<YourCommunities />);
    expect(screen.getByText('Hiking Club')).toBeTruthy();
    expect(screen.getByText('Chess')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/couldn.t load/i)).toBeNull();
  });

  it('Yours: nothing saved, offline: an offline message, not a blank list or a skeleton', () => {
    mine.mockReturnValue({ myCommunities: [], isLoading: false, isError: false, refetch: vi.fn() });
    render(<YourCommunities />);
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });

  it('Yours: online with a failed first load keeps the retryable error', () => {
    onLine = true;
    mine.mockReturnValue({ myCommunities: [], isLoading: false, isError: true, refetch: vi.fn() });
    render(<YourCommunities />);
    expect(screen.getByText(/couldn.t load your communities/i)).toBeTruthy();
  });

  it('Explore: saved list renders offline; "Show more" is not offered', () => {
    explore.mockReturnValue({
      communities: saved, isLoading: false, isError: true, isFetching: false,
      hasNextPage: true, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    });
    render(<ExploreCommunities />);
    expect(screen.getByText('Hiking Club')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Show more')).toBeNull();
  });

  it('Explore: nothing saved, offline: an offline message', () => {
    explore.mockReturnValue({
      communities: [], isLoading: false, isError: false, isFetching: false,
      hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    });
    render(<ExploreCommunities />);
    expect(screen.getByText("You're offline")).toBeTruthy();
  });

  it('switches back by itself when the connection returns', () => {
    explore.mockReturnValue({
      communities: [], isLoading: false, isError: false, isFetching: false,
      hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
    });
    render(<ExploreCommunities />);
    expect(screen.getByText("You're offline")).toBeTruthy();
    act(() => {
      onLine = true;
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText("You're offline")).toBeNull();
  });
});
