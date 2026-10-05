/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

const openViewer = vi.hoisted(() => vi.fn());
const media = vi.hoisted(() => ({ result: null, calls: [], fetchNextPage: vi.fn(), refetch: vi.fn() }));
const size = vi.hoisted(() => ({ value: { width: 0, height: 0 } }));

vi.mock('@shared/context/MediaViewerContext', () => ({
  useMediaViewerActions: () => ({ openViewer }),
}));
vi.mock('@shared/hooks/useElementSize', () => ({ useElementSize: () => size.value }));
vi.mock('../../../hooks/useConversationMedia', () => ({
  useConversationMedia: (conversationId, options) => {
    media.calls.push({ conversationId, ...options });
    return media.result;
  },
}));
// The tile's own behaviour is covered by its own tests; here it only needs to
// expose what the gallery hands it.
vi.mock('@shared/components/media/MediaThumb', () => ({
  default: ({ src, poster, type, ariaLabel, onClick, lazy }) => (
    <button
      type="button"
      data-testid="tile"
      data-src={src}
      data-poster={poster || ''}
      data-type={type}
      data-lazy={String(lazy)}
      aria-label={ariaLabel}
      onClick={onClick}
    />
  ),
}));

import { GalleryPreview } from '../galleryShared';
import ChatGalleryPage, { galleryViewerItem } from '../ChatGalleryPage';

const items = (n) => Array.from({ length: n }, (_, i) => ({
  id: `m${i}`,
  type: i % 2 ? 'video' : 'image',
  url: `chat/f-${i}.jpg`,
  thumbnailUrl: i % 2 ? `chat/f-${i}_thumb.jpg` : '',
}));

const result = (over = {}) => ({
  items: [], isPending: false, isError: false, hasNextPage: false,
  isFetchingNextPage: false, fetchNextPage: media.fetchNextPage, refetch: media.refetch, ...over,
});

beforeEach(() => {
  media.calls = [];
  media.fetchNextPage.mockReset();
  media.refetch.mockReset();
  media.result = result();
  size.value = { width: 0, height: 0 };
  openViewer.mockReset();
});
afterEach(cleanup);

describe('gallery preview', () => {
  it('asks for nothing until its row has been measured', () => {
    render(<GalleryPreview conversationId="c1" onOpen={() => {}} />);
    expect(media.calls.at(-1)).toMatchObject({ conversationId: 'c1', pageSize: 0 });
  });

  it('asks for exactly as many tiles as fit in the row it measured', () => {
    size.value = { width: 290, height: 90 };
    const { rerender } = render(<GalleryPreview conversationId="c1" onOpen={() => {}} />);
    const narrow = media.calls.at(-1).pageSize;

    size.value = { width: 560, height: 90 };
    rerender(<GalleryPreview conversationId="c1" onOpen={() => {}} />);
    const wide = media.calls.at(-1).pageSize;

    expect(narrow).toBe(3);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('draws only one row of tiles, eagerly, named by kind and position', () => {
    size.value = { width: 290, height: 90 };
    media.result = result({ items: items(10) });
    render(<GalleryPreview conversationId="c1" onOpen={() => {}} />);

    expect(screen.getAllByTestId('tile')).toHaveLength(3);
    expect(screen.getAllByTestId('tile')[0].dataset.lazy).toBe('false');
    expect(screen.getByRole('button', { name: 'Open photo 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open video 2' })).toBeTruthy();
  });

  it('the header and a tile both open the full gallery; the header is a named button', () => {
    size.value = { width: 290, height: 90 };
    media.result = result({ items: items(3) });
    const onOpen = vi.fn();
    render(<GalleryPreview conversationId="c1" onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open gallery' }));
    fireEvent.click(screen.getAllByTestId('tile')[0]);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('shows placeholders while the first answer is on its way - never "No media"', () => {
    size.value = { width: 290, height: 90 };
    media.result = result({ isPending: true });
    render(<GalleryPreview conversationId="c1" onOpen={() => {}} />);

    expect(screen.queryByText('No media')).toBeNull();
    expect(screen.queryAllByTestId('tile')).toHaveLength(0);
  });

  it('says "No media" only once the server has answered with none', () => {
    size.value = { width: 290, height: 90 };
    media.result = result({ items: [] });
    render(<GalleryPreview conversationId="c1" onOpen={() => {}} />);
    expect(screen.getByText('No media')).toBeTruthy();
  });

  it('reports a failed load with a retry, instead of pretending there is no media', () => {
    size.value = { width: 290, height: 90 };
    media.result = result({ isError: true });
    render(<GalleryPreview conversationId="c1" onOpen={() => {}} />);

    expect(screen.queryByText('No media')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(media.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('full gallery', () => {
  let observers;
  beforeEach(() => {
    observers = [];
    globalThis.IntersectionObserver = vi.fn(function IO(callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      observers.push(this);
    });
  });
  afterEach(() => { delete globalThis.IntersectionObserver; });

  it('sizes its first request from the screen it is on, once', () => {
    size.value = { width: 336, height: 600 };
    const { rerender } = render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    const first = media.calls.at(-1).pageSize;
    expect(first).toBeGreaterThanOrEqual(6);

    // Rotating the phone re-flows the tiles; it does not re-request the gallery.
    size.value = { width: 700, height: 300 };
    rerender(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    expect(media.calls.at(-1).pageSize).toBe(first);
  });

  it('asks for nothing before it has been measured', () => {
    render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    expect(media.calls.at(-1).pageSize).toBe(0);
  });

  it('loads the next page when the end comes into view, and not otherwise', () => {
    size.value = { width: 336, height: 600 };
    media.result = result({ items: items(12), hasNextPage: true });
    render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);

    const observer = observers.at(-1);
    observer.callback([{ isIntersecting: false }]);
    expect(media.fetchNextPage).not.toHaveBeenCalled();
    observer.callback([{ isIntersecting: true }]);
    expect(media.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('stops watching once there is nothing more, or while a page is already coming', () => {
    size.value = { width: 336, height: 600 };
    media.result = result({ items: items(12), hasNextPage: false });
    render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    expect(observers).toHaveLength(0);

    cleanup();
    media.result = result({ items: items(12), hasNextPage: true, isFetchingNextPage: true });
    render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    expect(observers).toHaveLength(0);
  });

  it('states the empty, loading and error cases separately', () => {
    size.value = { width: 336, height: 600 };

    media.result = result({ isPending: true });
    const view = render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    expect(screen.queryByText('No media')).toBeNull();
    view.unmount();

    media.result = result({ items: [] });
    const empty = render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    expect(screen.getByText('No media')).toBeTruthy();
    empty.unmount();

    media.result = result({ isError: true });
    render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t load/i);
  });

  it('keeps what is loaded on screen when a later page fails, and offers to retry that page', () => {
    size.value = { width: 336, height: 600 };
    media.result = result({ items: items(6), isError: true, hasNextPage: true });
    render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);

    expect(screen.getAllByTestId('tile')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(media.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('opens the viewer at the tapped index with every loaded entry mapped', () => {
    size.value = { width: 336, height: 600 };
    media.result = result({
      items: [
        { id: 'm1', type: 'image', url: 'chat/a.jpg', report: { targetType: 'MESSAGE', targetId: 'm1' } },
        { id: 'm2', type: 'image', url: 'chat/b.jpg' },
      ],
    });
    render(<ChatGalleryPage conversationId="c1" onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 2' }));

    expect(openViewer).toHaveBeenCalledWith(
      [
        { url: 'chat/a.jpg', type: 'image', id: 'm1', report: { targetType: 'MESSAGE', targetId: 'm1' } },
        { url: 'chat/b.jpg', type: 'image', id: 'm2' },
      ],
      1,
    );
  });
});

describe('gallery page → viewer items (opener contract)', () => {
  it('carries thumb, message id and the MESSAGE report target', () => {
    expect(galleryViewerItem({
      type: 'video',
      url: 'chat/v.mp4',
      thumbnailUrl: 'chat/v_thumb.jpg',
      id: 'm-9',
      report: { targetType: 'MESSAGE', targetId: 'm-9' },
    })).toEqual({
      url: 'chat/v.mp4',
      type: 'video',
      thumb: 'chat/v_thumb.jpg',
      id: 'm-9',
      report: { targetType: 'MESSAGE', targetId: 'm-9' },
    });
  });

  it('leaves report off for your own attachments', () => {
    const item = galleryViewerItem({ type: 'image', url: 'chat/x.png', id: 'm1' });
    expect(item).toEqual({ url: 'chat/x.png', type: 'image', id: 'm1' });
    expect('report' in item).toBe(false);
  });
});

describe('report target types used by the messages UI', () => {
  it('only passes values the API enum accepts (lowercase "user" was rejected with a 400)', () => {
    const schema = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../../../../../backend/prisma/schema.prisma'), 'utf8');
    const block = schema.match(/enum ReportTargetType \{([^}]*)\}/)[1];
    const allowed = new Set(block.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((l) => /^[A-Z_]+$/.test(l)));
    expect(allowed.has('USER')).toBe(true);

    const detailsDir = path.resolve(import.meta.dirname, '..');
    for (const file of fs.readdirSync(detailsDir).filter((f) => f.endsWith('.jsx'))) {
      const source = fs.readFileSync(path.join(detailsDir, file), 'utf8');
      for (const [, value] of source.matchAll(/targetType="([^"]+)"/g)) {
        expect(allowed.has(value), `${file}: targetType="${value}"`).toBe(true);
      }
    }
  });
});
