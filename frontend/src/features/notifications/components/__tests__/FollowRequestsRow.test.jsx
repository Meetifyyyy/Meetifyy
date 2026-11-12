/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ state: { requests: [], total: 0 }, navigate: vi.fn() }));

vi.mock('@shared/hooks/useFollowRequests', () => ({ useFollowRequests: () => h.state }));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span data-testid="avatar" /> }));

import FollowRequestsRow from '../FollowRequestsRow';

const entry = (id) => ({ user: { id, username: id, displayName: id, avatar: null }, createdAt: '' });

beforeEach(() => h.navigate.mockReset());
afterEach(cleanup);

describe('Follow requests row', () => {
  it('renders nothing when there are no requests', () => {
    h.state = { requests: [], total: 0 };
    const { container } = render(<FollowRequestsRow />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the count and at most two avatars', () => {
    h.state = { requests: [entry('a'), entry('b'), entry('c')], total: 7 };
    render(<FollowRequestsRow />);

    expect(screen.getByText('Follow requests')).toBeTruthy();
    expect(screen.getByText('7 requests')).toBeTruthy();
    expect(screen.getAllByTestId('avatar')).toHaveLength(2);
  });

  it('says "1 request" for one', () => {
    h.state = { requests: [entry('a')], total: 1 };
    render(<FollowRequestsRow />);
    expect(screen.getByText('1 request')).toBeTruthy();
  });

  it('opens the requests page', () => {
    h.state = { requests: [entry('a')], total: 1 };
    render(<FollowRequestsRow />);

    fireEvent.click(screen.getByRole('button'));

    expect(h.navigate).toHaveBeenCalledWith('/notifications/follow-requests', expect.any(Object));
  });
});
