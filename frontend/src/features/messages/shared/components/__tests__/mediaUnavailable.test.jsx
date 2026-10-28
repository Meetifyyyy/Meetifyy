/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

let onlineListener = null;
vi.mock('@shared/lib/networkStatus', () => ({
  subscribeOnline: (listener) => {
    onlineListener = listener;
    return () => {
      onlineListener = null;
    };
  },
}));

const { default: MediaUnavailable } = await import('../MediaUnavailable');

/**
 * A chat photo or video that cannot be shown keeps its place in the thread,
 * says which kind of failure it is, and comes back by itself when the
 * connection does — but never retries one the server refused.
 */
afterEach(() => {
  cleanup();
  onlineListener = null;
});

describe('MediaUnavailable', () => {
  it('keeps the media box at the media aspect ratio, so nothing around it moves', () => {
    const { container } = render(<MediaUnavailable kind="image" failure="load" aspect={1.5} onRetry={() => {}} />);
    expect(container.firstChild.style.getPropertyValue('--aspect')).toBe('1.5');
  });

  it('a failed load offers Retry and retries once when the connection returns', () => {
    const onRetry = vi.fn();
    render(<MediaUnavailable kind="image" failure="offline" onRetry={onRetry} />);
    expect(screen.getByRole('img', { name: "Photo couldn't load" })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    onlineListener(false);
    expect(onRetry).toHaveBeenCalledTimes(1);
    onlineListener(true);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('a refusal is final: no Retry, no automatic retry, and nothing about the media', () => {
    const onRetry = vi.fn();
    render(<MediaUnavailable kind="video" failure="unavailable" onRetry={onRetry} />);
    expect(screen.getByRole('img', { name: 'Video unavailable' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(onlineListener).toBeNull();
  });
});
