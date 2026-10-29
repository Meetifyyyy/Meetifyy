/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const voteInPoll = vi.fn();
vi.mock('@shared/api/apiClient', () => ({
  postsApi: { voteInPoll: (...a) => voteInPoll(...a) },
}));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me' } }),
}));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));

const { default: PollCard } = await import('../PollCard');

/**
 * The poll on a post: options in the author's order, one vote by option id
 * however fast it is tapped, and the results (with the viewer's choice
 * marked) only once they have voted.
 */
const poll = (over = {}) => ({
  options: [
    { id: 'opt-x', text: 'First', votes: 2 },
    { id: 'opt-y', text: 'Second', votes: 1 },
    { id: 'opt-z', text: 'Third', votes: 0 },
  ],
  totalVotes: 3,
  ...over,
});

function mount(p) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PollCard poll={p} postId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => { voteInPoll.mockReset(); });
afterEach(cleanup);

describe('PollCard', () => {
  it('lists the options in the order given, with no results before voting', () => {
    mount(poll());
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['First', 'Second', 'Third']);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText(/Choose one to see results/)).toBeTruthy();
  });

  it('votes once, by option id, however fast it is tapped', async () => {
    let finish;
    voteInPoll.mockImplementation(() => new Promise((r) => { finish = r; }));
    mount(poll());
    const second = screen.getByRole('button', { name: 'Second' });
    fireEvent.click(second);
    fireEvent.click(second);
    fireEvent.click(screen.getByRole('button', { name: 'Third' }));
    await waitFor(() => expect(voteInPoll).toHaveBeenCalledTimes(1));
    expect(voteInPoll).toHaveBeenCalledWith('p1', { optionId: 'opt-y' });
    finish({ poll: null });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Second' }).disabled).toBe(false));
    expect(voteInPoll).toHaveBeenCalledTimes(1);
  });

  it("shows results that add up to 100, with the viewer's vote marked", () => {
    mount(poll({ userVotedOptionId: 'opt-y' }));
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'First: 67 percent, 2 votes',
      'Second: 33 percent, 1 vote, your vote',
      'Third: 0 percent, 0 votes',
    ]);
    expect(screen.getByText(/You voted/)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a failed vote leaves the poll open to vote again', async () => {
    voteInPoll.mockRejectedValue(Object.assign(new Error('nope'), { status: 500 }));
    mount(poll());
    fireEvent.click(screen.getByRole('button', { name: 'Third' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Third' }).disabled).toBe(false));
  });
});
