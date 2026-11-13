/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

/**
 * A follow row hands the button the server's answer (FEP-11), so the button
 * does not look the person up with its own profile request. With no answer
 * (an older server) it passes nothing and the button resolves it as before.
 */
const seen = vi.hoisted(() => []);
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@shared/components/ui/FollowButton', () => ({
  default: (props) => {
    seen.push(props);
    return <button>follow-button</button>;
  },
}));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@shared/api/apiClient', () => ({ getMediaUrl: (v) => v }));

import NotificationItem from '../NotificationItem';

afterEach(() => {
  cleanup();
  seen.length = 0;
});

const follow = (actorExtra = {}) => ({
  id: 'n1',
  type: 'FOLLOW',
  body: 'Asha started following you.',
  createdAt: '2026-11-13T10:00:00.000Z',
  actor: { id: 'u1', username: 'asha', displayName: 'Asha', ...actorExtra },
});
const renderRow = (notif, actor = { name: 'Asha', username: 'asha' }) =>
  render(<NotificationItem notif={notif} actor={actor} timeStr="1m" onClick={() => {}} />);

describe('follow notification row', () => {
  it.each([true, false])('passes isFollowing=%s straight to the button', (isFollowing) => {
    renderRow(follow({ isFollowing }));
    expect(seen.at(-1)).toMatchObject({ targetUsername: 'asha', initialFollowing: isFollowing });
  });

  it('passes nothing when the server did not say', () => {
    renderRow(follow());
    expect(seen.at(-1).initialFollowing).toBeUndefined();
  });

  it('never hands one person’s answer to another person’s button', () => {
    renderRow(follow({ isFollowing: true }), { name: 'Ravi', username: 'ravi' });
    expect(seen.at(-1)).toMatchObject({ targetUsername: 'ravi', initialFollowing: undefined });
  });
});
