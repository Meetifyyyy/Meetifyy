/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * What the match card says (IM-19, IM-26): "They're in" when the other side
 * has accepted, "Request sent" and "Withdraw" only for a request this person
 * sent, never for a match they accepted.
 */
const state = vi.hoisted(() => ({ value: null }));
vi.mock('../../../context/InstantMatchContext', async (importActual) => ({
  ...(await importActual()),
  useInstantMatch: () => state.value,
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', interests: [] } }),
}));
vi.mock('../../../hooks/useMatchTimer', () => ({
  useMatchTimer: () => ({ timeLeft: 20 }),
}));

const { default: MatchPopup } = await import('../MatchPopup');

const card = (over = {}) => ({
  matchId: 'm1',
  candidate: { id: 'x', username: 'asha', displayName: 'Asha Rao' },
  activity: 'study',
  area: null,
  timer: 30,
  expiresAt: Date.now() + 30_000,
  ...over,
});
const show = (status, activeMatch) => {
  state.value = {
    status, activeMatch, isVerified: true, busy: false,
    respondToMatch: vi.fn(), handleMatchTimeout: vi.fn(),
  };
  render(<MatchPopup />);
};

afterEach(cleanup);

describe('the match card', () => {
  it('says the other side is in once they have accepted', () => {
    show('match_found', card({ partnerAccepted: true }));
    expect(screen.getByText('They\'re in')).toBeTruthy();
    expect(screen.getByText('Asha is in. Accept to start chatting.')).toBeTruthy();
  });

  it('keeps a plain card plain', () => {
    show('match_found', card());
    expect(screen.getByText('Match found')).toBeTruthy();
    expect(screen.queryByText(/is in\. Accept/)).toBeNull();
  });

  it('does not repeat it on a request, which already says they want this', () => {
    show('match_found', card({ requested: true, partnerAccepted: true }));
    expect(screen.getByText('Match request')).toBeTruthy();
    expect(screen.queryByText(/is in\. Accept/)).toBeNull();
  });

  it('waits on an accepted match without calling it a request', () => {
    show('waiting', card({ awaitingOther: true, requestSent: false }));
    expect(screen.getByText('You\'re in')).toBeTruthy();
    expect(screen.queryByText('Request sent')).toBeNull();
    expect(screen.queryByText('Withdraw request')).toBeNull();
  });

  it('offers to withdraw a request this person sent', () => {
    show('waiting', card({ awaitingOther: true, requestSent: true }));
    expect(screen.getAllByText('Request sent').length).toBeGreaterThan(0);
    expect(screen.getByText('Withdraw request')).toBeTruthy();
  });
});
