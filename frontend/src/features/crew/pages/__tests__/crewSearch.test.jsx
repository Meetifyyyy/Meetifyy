/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/**
 * Activity search: the For You list while the box is empty, server matches
 * (activities only) once typed, the Crew pills narrow the pool, and Back
 * returns to the Crew entry it came from.
 */

const searchCalls = [];
const feed = (activities) => ({ activities, isLoading: false, isError: false, hasNextPage: false });
vi.mock('@shared/hooks/useCrew', () => ({
  useActivities: (scope) => feed(scope === 'for_you' ? [{ id: 'f', title: 'Morning Run' }] : []),
  useCrewDiscover: () => ({ collegeName: null }),
  useSavedActivitiesQuery: () => ({ savedActivitiesData: [{ id: 's1', title: 'Chess Night' }, { id: 's2', title: 'Pottery' }], isLoading: false }),
  useMyActivitiesQuery: () => ({ myActivitiesData: [], isLoading: false }),
}));
vi.mock('@features/search/hooks/useGlobalSearch', () => ({
  useGlobalSearch: (q, limit, type) => {
    searchCalls.push([q, type]);
    return {
      results: { crew: q ? [{ item: { id: 'x', title: `Match ${q}` } }] : [] },
      isLoading: false, isSearching: false, isError: false, hasNextPage: false,
    };
  },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u' }, collegeName: null }) }));
vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/hooks/prefetch', () => ({ prefetchActivity: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@shared/utils/mapActivity', () => ({ mapActivity: (a) => a }));
vi.mock('@features/search/components/SearchLayout', () => ({
  default: ({ children }) => <main>{children}</main>,
}));
vi.mock('../../components/cards/CrewCard', () => ({
  default: ({ activity }) => <article>{activity.title}</article>,
}));

const { default: CrewSearchRoute } = await import('../CrewSearchRoute');

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderAt() {
  render(
    <MemoryRouter initialEntries={['/crew?tab=saved', { pathname: '/crew/search', state: { fromCrew: true } }]} initialIndex={1}>
      <Routes>
        <Route path="/crew" element={<Where />} />
        <Route path="/crew/search" element={<CrewSearchRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CrewSearchRoute', () => {
  afterEach(cleanup);

  it('shows For You while empty and server activity matches once typed', async () => {
    renderAt();
    expect(screen.getByText('Morning Run')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search activities'), { target: { value: 'yoga' } });
    await waitFor(() => expect(screen.getByText('Results for “yoga”')).toBeTruthy());
    expect(screen.getByText('Match yoga')).toBeTruthy();
    expect(searchCalls).toContainEqual(['yoga', 'activities']);
  });

  it('shows the Crew pills and filters the selected pill locally', async () => {
    renderAt();
    for (const name of ['All', '1-on-1', 'My Activities', 'Saved']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Saved' }));
    await waitFor(() => expect(screen.getByText('Pottery')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Search activities'), { target: { value: 'chess' } });
    await waitFor(() => expect(screen.queryByText('Pottery')).toBeNull());
    expect(screen.getByText('Chess Night')).toBeTruthy();
  });

  it('Back returns to the Crew entry it was opened from', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Back to crew' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/crew?tab=saved'));
  });
});
