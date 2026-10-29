/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => ({ src: value || '', failed: false, pending: false, attempt: 0, refresh: vi.fn() }),
}));

import ChatMessageList from '../ChatMessageList';

/**
 * "@name has requested to join the group": a line in the group's timeline
 * for its owner and admins, drawn from the requests the server sends them,
 * never from the message list. Shown only when the caller hands them over
 * (GroupChatArea does, for reviewers only), in time order between the
 * messages, never in find-in-chat, and with Review while pending.
 */
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  delete globalThis.ResizeObserver;
});

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const messages = [
  { id: 'a', senderId: 'u-me', from: 'me', status: 'read', createdAt: minutesAgo(30), text: 'first' },
  { id: 'b', senderId: 'u-a', status: 'read', createdAt: minutesAgo(10), text: 'second' },
];
const request = (over = {}) => ({
  id: 'r1',
  kind: 'JOIN_REQUESTED',
  status: 'PENDING',
  createdAt: minutesAgo(20),
  decidedAt: null,
  decidedByUsername: null,
  user: { id: 'u-x', username: 'xyz', displayName: 'Xyz', avatar: null },
  ...over,
});

function mount(props) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ChatMessageList
          messages={messages}
          conversation={{ id: 'c1', type: 'GROUP', isGroup: true }}
          currentUser={{ id: 'u-me' }}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the admins' request lines", () => {
  it('are not drawn without the reviewer-only list (a member sees none)', () => {
    const { container } = mount({});
    expect(container.querySelector('[data-admin-only]')).toBeNull();
    expect(container.textContent).not.toMatch(/requested to join/);
  });

  it('sit between the messages at the time asked, with who can see them', () => {
    const onReviewRequests = vi.fn();
    const { container } = mount({ adminUpdates: [request()], onReviewRequests });
    const text = container.textContent;
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('has requested to join'));
    expect(text.indexOf('has requested to join')).toBeLessThan(text.indexOf('second'));
    expect(container.querySelector('[data-admin-only]').textContent).toMatch(/@xyz has requested to join the group/);
    expect(screen.getByText('@xyz')).toBeTruthy();
    expect(screen.getByText('Only admins can see this')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onReviewRequests).toHaveBeenCalledTimes(1);
  });

  it('say how an answered request went, with no Review', () => {
    mount({ adminUpdates: [request({ status: 'APPROVED' }), request({ id: 'r2', status: 'REJECTED', createdAt: minutesAgo(15), user: { id: 'u-y', username: 'yy', displayName: 'Y' } })] });
    expect(screen.getByText('· Approved')).toBeTruthy();
    expect(screen.getByText('· Declined')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  });

  it('are left out of find-in-chat', () => {
    const { container } = mount({ adminUpdates: [request()], searchQuery: 'xyz' });
    expect(container.querySelector('[data-admin-only]')).toBeNull();
  });

  it('older than the loaded history wait for it to load', () => {
    const old = request({ createdAt: minutesAgo(600) });
    const { container, rerender } = mount({ adminUpdates: [old], hasMore: true });
    expect(container.querySelector('[data-admin-only]')).toBeNull();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ChatMessageList
            messages={messages}
            conversation={{ id: 'c1', type: 'GROUP', isGroup: true }}
            currentUser={{ id: 'u-me' }}
            adminUpdates={[old]}
            hasMore={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector('[data-admin-only]')).toBeTruthy();
  });
});
