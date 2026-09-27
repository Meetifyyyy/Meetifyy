/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/**
 * Community search: suggestions while the box is empty, server matches once
 * something is typed, and Back returns to the Communities entry it came from.
 */

const exploreCalls = [];
vi.mock('@shared/hooks/useCommunities', () => ({
  useExploreCommunities: ({ search }) => {
    exploreCalls.push(search);
    const all = [{ id: 'a', name: 'Chess Club' }, { id: 'b', name: 'Film Society' }];
    return {
      communities: all.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
      isLoading: false, isError: false, isPlaceholderData: false, hasNextPage: false,
    };
  },
}));
vi.mock('@shared/hooks/useCommunityRecommendations', () => ({
  useCommunityRecommendations: () => ({ recommendations: [{ id: 'r', name: 'Robotics Lab' }], isLoading: false }),
}));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
// The shared search frame's side column fetches its own data; it is not what
// these tests are about.
vi.mock('@features/search/components/SearchLayout', () => ({
  default: ({ children }) => <main>{children}</main>,
}));
vi.mock('../../components/directory/CommunityRow', () => ({
  default: ({ community }) => <article>{community.name}</article>,
}));

const { default: CommunitySearchRoute } = await import('../CommunitySearchRoute');

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderAt() {
  render(
    <MemoryRouter initialEntries={['/communities?tab=explore', { pathname: '/communities/search', state: { fromCommunities: true } }]} initialIndex={1}>
      <Routes>
        <Route path="/communities" element={<Where />} />
        <Route path="/communities/search" element={<CommunitySearchRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CommunitySearchRoute', () => {
  afterEach(cleanup);

  it('shows suggestions for an empty query and matches once typed', async () => {
    renderAt();
    expect(screen.getByText('Robotics Lab')).toBeTruthy();
    expect(screen.getByText('Communities to discover')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search communities'), { target: { value: 'chess' } });
    await waitFor(() => expect(screen.getByText('Results for “chess”')).toBeTruthy());
    expect(screen.getByText('Chess Club')).toBeTruthy();
    expect(screen.queryByText('Film Society')).toBeNull();
    expect(exploreCalls).toContain('chess');
  });

  it('Back returns to the Communities entry it was opened from', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Back to communities' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/communities?tab=explore'));
  });
});
