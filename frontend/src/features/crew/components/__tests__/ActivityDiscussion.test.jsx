/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ discussion: vi.fn(), sendMessage: vi.fn() }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@shared/components/badges/CollegeRepresentativeBadge', () => ({ CollegeRepresentativeBadge: () => null }));
vi.mock('../../hooks/useActivityDiscussion', () => ({ useActivityDiscussion: mocks.discussion }));

import ActivityDiscussion from '../ActivityDiscussion';

beforeEach(() => {
  mocks.sendMessage.mockReset().mockResolvedValue({});
  mocks.discussion.mockReset().mockReturnValue({
    messages: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isFetchingMore: false,
    loadMore: vi.fn(),
    sendMessage: mocks.sendMessage,
    isSending: false,
    sendError: null,
  });
});
afterEach(cleanup);

const composer = () => screen.getByPlaceholderText('Write a message…');

it('shows nothing in the message area while the history loads', () => {
  mocks.discussion.mockReturnValue({ ...mocks.discussion(), isLoading: true });
  const { container } = render(<ActivityDiscussion activityId="a" />);
  // No placeholder rows, no loading text, and not the empty state either.
  expect(container.querySelector('[aria-label="Loading discussion"]')).toBeNull();
  expect(screen.queryByText('No messages yet')).toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
});

it('caps the composer at 200 characters and says so only at the limit', () => {
  render(<ActivityDiscussion activityId="a" />);
  expect(composer().maxLength).toBe(200);

  fireEvent.change(composer(), { target: { value: 'a'.repeat(199) } });
  expect(screen.queryByText('Text limit reached')).toBeNull();

  fireEvent.change(composer(), { target: { value: 'a'.repeat(200) } });
  expect(screen.getByRole('status').textContent).toBe('Text limit reached');

  // Deleting a character takes the notice away again.
  fireEvent.change(composer(), { target: { value: 'a'.repeat(150) } });
  expect(screen.queryByText('Text limit reached')).toBeNull();
});

it('still sends a message that is exactly at the limit', async () => {
  render(<ActivityDiscussion activityId="a" />);
  const text = 'b'.repeat(200);
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(text));
});

it('does not trap scroll: the list and the panel let a gesture chain to the page', () => {
  // CSS modules are not applied in jsdom, so the source is the thing to check:
  // `overscroll-behavior: contain` on either block is what stopped the page
  // behind the box from moving once the box reached its top or bottom.
  const css = readFileSync(resolve(import.meta.dirname, '../ActivityDiscussion.module.css'), 'utf8');
  const blockOf = (selector) => css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  expect(blockOf('\\.messages')).not.toMatch(/overscroll-behavior[^;]*contain/);
  expect(blockOf('\\.inline')).not.toMatch(/overscroll-behavior[^;]*contain/);
});
