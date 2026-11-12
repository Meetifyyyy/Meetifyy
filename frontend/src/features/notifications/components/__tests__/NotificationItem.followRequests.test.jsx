/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@shared/components/ui/FollowButton', () => ({ default: () => <button>follow-button</button> }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@shared/api/apiClient', () => ({ getMediaUrl: (v) => v }));

import NotificationItem from '../NotificationItem';

afterEach(cleanup);

const row = (type, body) => ({
  id: 'n1',
  type,
  body,
  createdAt: '2026-11-12T10:00:00.000Z',
  actor: { id: 'u1', username: 'asha', displayName: 'Asha' },
});
const actor = { name: 'Asha', username: 'asha' };
const renderRow = (notif) => render(<NotificationItem notif={notif} actor={actor} timeStr="1m" onClick={() => {}} />);

describe('follow request notifications', () => {
  it('reads "<name> requested to follow you."', () => {
    renderRow(row('FOLLOW_REQUEST', 'Asha requested to follow you.'));
    expect(screen.getByText('Asha')).toBeTruthy();
    expect(screen.getByText('requested to follow you.')).toBeTruthy();
    // The answer happens on the requests page, not with a follow button here.
    expect(screen.queryByText('follow-button')).toBeNull();
  });

  it('reads "<name> accepted your follow request."', () => {
    renderRow(row('FOLLOW_ACCEPTED', 'Asha accepted your follow request.'));
    expect(screen.getByText('accepted your follow request.')).toBeTruthy();
  });
});
