/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock('@shared/hooks/useDebounce', () => ({ useDebounce: (v) => v }));
vi.mock('@shared/hooks/useProfile', () => ({
  useDirectory: () => ({ users: [], isLoading: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
}));
vi.mock('@shared/academics/useAcademicCatalog', () => ({
  useAcademicCatalog: () => ({
    courses: [
      { id: 'btech', name: 'B.Tech' },
      { id: 'bca', name: 'BCA' },
      { id: 'mba', name: 'MBA' },
    ],
  }),
}));
vi.mock('../../components/affiliation/CampusAffiliationGate', () => ({ default: ({ children }) => children }));

import DirectoryPage from '../DirectoryPage';

afterEach(cleanup);

const open = () => {
  const button = screen.getByRole('button', { name: /Course|B\.Tech|BCA|MBA/ });
  fireEvent.click(button);
};
// Options are divs; the trigger's label is a span inside a button.
const options = () => screen.getAllByText(/^(B\.Tech|BCA|MBA)$/).filter((el) => el.tagName === 'DIV');
const labels = () => options().map((el) => el.textContent);

function renderPage() {
  return render(<MemoryRouter><DirectoryPage /></MemoryRouter>);
}

describe('directory filter menus', () => {
  it('lists the chosen option first only when the menu is opened again', () => {
    renderPage();
    open();
    expect(labels()).toEqual(['B.Tech', 'BCA', 'MBA']);

    // Choosing closes the menu; nothing is reordered on screen to show it.
    fireEvent.click(options()[2]);
    expect(screen.queryByText('BCA')).toBeNull();

    // Next open: the selection leads, the rest keep their order.
    open();
    expect(labels()).toEqual(['MBA', 'B.Tech', 'BCA']);
  });

  it('choosing the selected option again clears the filter', () => {
    renderPage();
    open();
    fireEvent.click(options()[1]);
    expect(screen.getByRole('button', { name: 'BCA' })).toBeTruthy();

    open();
    fireEvent.click(options()[0]); // BCA is listed first now
    expect(screen.getByRole('button', { name: 'Course' })).toBeTruthy();
  });
});
