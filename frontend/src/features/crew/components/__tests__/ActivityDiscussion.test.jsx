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

it('shows a spinner, not placeholder rows, while the history loads', () => {
  mocks.discussion.mockReturnValue({ ...mocks.discussion(), isLoading: true });
  render(<ActivityDiscussion activityId="a" />);
  expect(screen.getByRole('status', { name: 'Loading discussion' })).toBeTruthy();
  // Neither the empty state nor an error while it is still loading.
  expect(screen.queryByText('No messages yet')).toBeNull();
  expect(screen.queryByText(/Couldn't load/)).toBeNull();
});

it('drops the spinner once the history has loaded', () => {
  render(<ActivityDiscussion activityId="a" />);
  expect(screen.queryByRole('status', { name: 'Loading discussion' })).toBeNull();
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

it('shows the composer when the viewer may post, and by default', () => {
  const { rerender } = render(<ActivityDiscussion activityId="a" closedNote="Closed." />);
  expect(composer()).toBeTruthy();
  expect(screen.queryByText('Closed.')).toBeNull();
  rerender(<ActivityDiscussion activityId="a" canPost closedNote="Closed." />);
  expect(composer()).toBeTruthy();
});

it('replaces the composer with the note when the viewer may not post, and keeps the messages', () => {
  mocks.discussion.mockReturnValue({
    ...mocks.discussion(),
    messages: [{ id: 'm1', userId: 'other', text: 'See you at nine', createdAt: new Date().toISOString() }],
  });
  render(<ActivityDiscussion activityId="a" canPost={false} closedNote="This activity has ended." />);
  expect(screen.getByText('See you at nine')).toBeTruthy();
  expect(screen.getByText('This activity has ended.')).toBeTruthy();
  expect(screen.queryByPlaceholderText('Write a message…')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
});

it('does not invite a read-only viewer to start the conversation', () => {
  render(<ActivityDiscussion activityId="a" canPost={false} closedNote="Join this activity to take part in the discussion." />);
  expect(screen.getByText('No messages yet')).toBeTruthy();
  expect(screen.queryByText('Start the conversation about this activity.')).toBeNull();
});

it('shows the send error, such as the server reason for a refused post', () => {
  mocks.discussion.mockReturnValue({ ...mocks.discussion(), sendError: 'This activity has ended.' });
  render(<ActivityDiscussion activityId="a" />);
  expect(screen.getByText('This activity has ended.')).toBeTruthy();
});
