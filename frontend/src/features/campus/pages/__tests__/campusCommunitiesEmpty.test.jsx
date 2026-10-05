/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@shared/hooks/useSmartBack', () => ({ useSmartBack: () => vi.fn() }));
vi.mock('@shared/hooks/useCommunities', () => ({ useCampusCommunities: () => ({ campusCommunities: [], isLoading: false }) }));
vi.mock('@shared/components/VerificationGate/VerificationGate', () => ({ default: ({ children }) => children }));

import { EmptyCommunities } from '../CampusCommunitiesPage';

afterEach(cleanup);

describe('campus communities empty state', () => {
  it('invites the first community when the campus has none, with one action', () => {
    const onCreate = vi.fn();
    render(<EmptyCommunities searching={false} query="" onCreate={onCreate} />);

    expect(screen.getByRole('heading', { name: 'No communities yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create community/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('says a search found nothing - and does not push creating a community', () => {
    render(<EmptyCommunities searching query="chess" onCreate={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();
    expect(screen.getByText('chess')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('carries no emoji decoration', () => {
    const { container } = render(<EmptyCommunities searching={false} query="" onCreate={vi.fn()} />);
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
