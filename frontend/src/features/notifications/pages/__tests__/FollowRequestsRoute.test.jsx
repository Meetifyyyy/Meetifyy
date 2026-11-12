/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The follow requests page: the list, answering a request, and paging.
 */
const h = vi.hoisted(() => ({
  getFollowRequests: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  navigate: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@shared/api/apiClient', () => ({
  usersApi: {
    getFollowRequests: (...a) => h.getFollowRequests(...a),
    acceptFollowRequest: (...a) => h.accept(...a),
    declineFollowRequest: (...a) => h.decline(...a),
  },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me', username: 'me' } }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('@shared/utils/toast', () => ({ showToast: (...a) => h.showToast(...a) }));
vi.mock('@shared/hooks/useSystemBars', () => ({ useSystemBars: () => {} }));
vi.mock('@layout/PageHeader', () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span data-testid="avatar" /> }));

import FollowRequestsRoute from '../FollowRequestsRoute';
import { FOLLOW_REQUESTS_KEY } from '@shared/hooks/useFollowRequests';
import { PROFILE_KEYS } from '@shared/hooks/useProfile';

let observers;
beforeEach(() => {
  observers = [];
  globalThis.IntersectionObserver = class {
    constructor(cb) { observers.push(cb); }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const req = (id, username) => ({
  user: { id, username, displayName: username.toUpperCase(), avatar: null },
  createdAt: '2026-11-12T10:00:00.000Z',
});
const page = (requests, { nextCursor = null, total = requests.length } = {}) => ({ requests, nextCursor, total });

let qc;
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FollowRequestsRoute />
    </QueryClientProvider>,
  );
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe('Follow requests page', () => {
  it('lists the requests, newest first, with Accept and Decline', async () => {
    h.getFollowRequests.mockResolvedValue(page([req('u1', 'asha'), req('u2', 'ravi')]));
    mount();

    expect(await screen.findByText('@asha')).toBeTruthy();
    expect(screen.getByText('@ravi')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Accept request from ASHA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Decline request from RAVI/ })).toBeTruthy();
  });

  it('shows an empty state when there are none', async () => {
    h.getFollowRequests.mockResolvedValue(page([]));
    mount();

    expect(await screen.findByText('No follow requests')).toBeTruthy();
  });

  it('removes a row the moment Accept is tapped, and updates the follower count from the answer', async () => {
    h.getFollowRequests.mockResolvedValue(page([req('u1', 'asha'), req('u2', 'ravi')]));
    let answer;
    h.accept.mockReturnValue(new Promise((res) => { answer = res; }));
    mount();
    qc.setQueryData(PROFILE_KEYS.byUsername('me'), { username: 'me', stats: { followers: 4 } });
    await screen.findByText('@asha');

    fireEvent.click(screen.getByRole('button', { name: /Accept request from ASHA/ }));

    await waitFor(() => expect(screen.queryByText('@asha')).toBeNull());
    expect(screen.getByText('@ravi')).toBeTruthy();
    expect(h.accept).toHaveBeenCalledWith('u1');
    expect(qc.getQueryData(FOLLOW_REQUESTS_KEY).pages[0].total).toBe(1);

    await act(async () => answer({ success: true, followersCount: 5 }));
    expect(qc.getQueryData(PROFILE_KEYS.byUsername('me')).stats.followers).toBe(5);
    expect(qc.getQueryData(PROFILE_KEYS.byUsername('me')).followersCount).toBe(5);
  });

  it('removes a row on Decline', async () => {
    h.getFollowRequests.mockResolvedValue(page([req('u1', 'asha'), req('u2', 'ravi')]));
    h.decline.mockResolvedValue({ success: true });
    mount();
    await screen.findByText('@ravi');

    fireEvent.click(screen.getByRole('button', { name: /Decline request from RAVI/ }));

    await waitFor(() => expect(screen.queryByText('@ravi')).toBeNull());
    expect(h.decline).toHaveBeenCalledWith('u2');
    expect(h.accept).not.toHaveBeenCalled();
  });

  it('puts the row back and says so when the request fails', async () => {
    h.getFollowRequests.mockResolvedValue(page([req('u1', 'asha')]));
    h.accept.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    mount();
    await screen.findByText('@asha');

    fireEvent.click(screen.getByRole('button', { name: /Accept request from ASHA/ }));
    await flush();

    expect(screen.getByText('@asha')).toBeTruthy();
    expect(h.showToast).toHaveBeenCalledWith('Something went wrong. Please try again.', 'error');
  });

  it('treats a 404 as already handled: the row stays gone and nothing is reported', async () => {
    h.getFollowRequests.mockResolvedValue(page([req('u1', 'asha'), req('u2', 'ravi')]));
    h.accept.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    mount();
    await screen.findByText('@asha');

    fireEvent.click(screen.getByRole('button', { name: /Accept request from ASHA/ }));
    await flush();

    expect(screen.queryByText('@asha')).toBeNull();
    expect(screen.getByText('@ravi')).toBeTruthy();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('loads the next page by cursor when the end of the list scrolls into view', async () => {
    h.getFollowRequests
      .mockResolvedValueOnce(page([req('u1', 'asha')], { nextCursor: 'cur-1', total: 2 }))
      .mockResolvedValueOnce(page([req('u2', 'ravi')], { nextCursor: null, total: 2 }));
    mount();
    await screen.findByText('@asha');
    expect(h.getFollowRequests).toHaveBeenLastCalledWith({ cursor: undefined, limit: 20 });

    await act(async () => { observers.forEach((cb) => cb([{ isIntersecting: true }])); });

    expect(await screen.findByText('@ravi')).toBeTruthy();
    expect(h.getFollowRequests).toHaveBeenLastCalledWith({ cursor: 'cur-1', limit: 20 });
    expect(screen.getByText('@asha')).toBeTruthy();
  });

  it('opens the requester\'s profile from the row, not from its buttons', async () => {
    h.getFollowRequests.mockResolvedValue(page([req('u1', 'asha')]));
    h.accept.mockResolvedValue({ success: true, followersCount: 1 });
    mount();
    const row = (await screen.findByText('@asha')).closest('div[class*="row"]');

    fireEvent.click(within(row).getByRole('button', { name: /Accept/ }));
    expect(h.navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('@asha'));
    expect(h.navigate).toHaveBeenCalledWith('/profile/asha', expect.any(Object));
  });
});
