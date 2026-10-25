/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const LONG = 'Aarav Krishnamurthy Venkataraman Subramanian Iyer';

vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock('@shared/hooks/useDebounce', () => ({ useDebounce: (v) => v }));
vi.mock('@shared/hooks/useProfile', () => ({
  useDirectory: () => ({
    users: [
      { id: 'u1', username: 'rep', displayName: LONG, isCampusRep: true },
      { id: 'u2', username: 'member', displayName: 'Diya', isCampusRep: false },
    ],
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock('@shared/academics/useAcademicCatalog', () => ({ useAcademicCatalog: () => ({ courses: [] }) }));
vi.mock('../../components/affiliation/CampusAffiliationGate', () => ({ default: ({ children }) => children }));

import DirectoryPage from '../DirectoryPage';

afterEach(cleanup);

describe('directory cards', () => {
  it('shows the representative badge beside a representative’s name, however long', () => {
    render(<MemoryRouter><DirectoryPage /></MemoryRouter>);
    const repName = screen.getByText(LONG);
    const row = repName.closest('h4');
    // The full name stays available when the line cuts it short.
    expect(row.getAttribute('title')).toBe(LONG);
    expect(row.querySelector('[aria-label="Campus Representative"]')).toBeTruthy();

    const member = screen.getByText('Diya').closest('h4');
    expect(member.querySelector('[aria-label$="Representative"]')).toBeNull();
  });
});
