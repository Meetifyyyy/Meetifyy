/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

const openViewer = vi.hoisted(() => vi.fn());

vi.mock('@shared/context/MediaViewerContext', () => ({
  useMediaViewerActions: () => ({ openViewer }),
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

import { GalleryStrip, GalleryCoverageNote, GALLERY_STRIP_LIMIT, galleryOrigin } from '../galleryShared';
import ChatGalleryPage, { galleryViewerItem } from '../ChatGalleryPage';

const items = (n) => Array.from({ length: n }, (_, i) => ({
  type: i % 2 ? 'video' : 'image',
  url: `chat/f-${i}.jpg`,
  thumbnailUrl: i % 2 ? `chat/f-${i}_thumb.jpg` : '',
}));

describe('gallery strip', () => {
  afterEach(cleanup);

  it('mounts at most 12 tiles however long the history is', () => {
    render(<GalleryStrip mediaList={items(300)} onOpen={() => {}} />);
    expect(screen.getAllByTestId('tile')).toHaveLength(GALLERY_STRIP_LIMIT);
    expect(GALLERY_STRIP_LIMIT).toBe(12);
  });

  it('names each tile by kind and position within the whole gallery, without inventing a description', () => {
    render(<GalleryStrip mediaList={items(30)} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open photo 1 of 30' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open video 2 of 30' })).toBeTruthy();
  });

  it('the header is a real, named button', () => {
    const onOpen = vi.fn();
    render(<GalleryStrip mediaList={items(5)} onOpen={onOpen} />);
    const header = screen.getByRole('button', { name: 'Open gallery, 5 items' });
    expect(header.tagName).toBe('BUTTON');
    fireEvent.click(header);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state without tiles', () => {
    render(<GalleryStrip mediaList={[]} onOpen={() => {}} />);
    expect(screen.getByText('No media')).toBeTruthy();
    expect(screen.queryAllByTestId('tile')).toHaveLength(0);
  });
});

describe('coverage note', () => {
  afterEach(cleanup);

  it('says the gallery covers loaded messages and offers to load older ones', () => {
    const onLoadMore = vi.fn();
    render(<GalleryCoverageNote hasMore isLoadingMore={false} onLoadMore={onLoadMore} />);
    expect(screen.getByText(/messages loaded so far/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables the action while a page is loading', () => {
    render(<GalleryCoverageNote hasMore isLoadingMore onLoadMore={() => {}} />);
    expect(screen.getByRole('button', { name: /Loading/ }).disabled).toBe(true);
  });

  it('is silent once the whole history is loaded', () => {
    const { container } = render(<GalleryCoverageNote hasMore={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('still states the limit when it has not been told about paging', () => {
    render(<GalleryCoverageNote />);
    expect(screen.getByText(/messages loaded so far/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('galleryOrigin', () => {
  const me = { id: 'u-me' };

  it('reports a confirmed message from someone else by the message id', () => {
    expect(galleryOrigin({ id: 'm-1', senderId: 'u-other' }, me)).toEqual({
      id: 'm-1',
      report: { targetType: 'MESSAGE', targetId: 'm-1' },
    });
  });

  it('keeps the id but offers no report for your own message', () => {
    const o = galleryOrigin({ id: 'm-2', senderId: 'u-me' }, me);
    expect(o.id).toBe('m-2');
    expect(o.report).toBeUndefined();
  });

  it('has neither for an unconfirmed message', () => {
    expect(galleryOrigin({ id: 'temp_123', senderId: 'u-other' }, me)).toEqual({});
    expect(galleryOrigin({ id: 'c_temp_9', senderId: 'u-other' }, me)).toEqual({});
    expect(galleryOrigin({ id: 'm-3', senderId: 'u-other', isOptimistic: true }, me)).toEqual({});
    expect(galleryOrigin({ senderId: 'u-other' }, me)).toEqual({});
  });
});

describe('gallery page → viewer items (opener contract)', () => {
  beforeEach(() => openViewer.mockReset());
  afterEach(cleanup);

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

  it('leaves report off for entries that are not a confirmed message from someone else', () => {
    const item = galleryViewerItem({ type: 'image', url: 'https://example.com/x.png' });
    expect(item).toEqual({ url: 'https://example.com/x.png', type: 'image' });
    expect('report' in item).toBe(false);
  });

  it('opens the viewer at the tapped index with every entry mapped', () => {
    const list = [
      { type: 'image', url: 'chat/a.jpg', id: 'm1', report: { targetType: 'MESSAGE', targetId: 'm1' } },
      { type: 'image', url: 'chat/b.jpg' },
    ];
    render(<ChatGalleryPage mediaList={list} onBack={() => {}} hasMore={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 2 of 2' }));
    expect(openViewer).toHaveBeenCalledWith(
      [
        { url: 'chat/a.jpg', type: 'image', id: 'm1', report: { targetType: 'MESSAGE', targetId: 'm1' } },
        { url: 'chat/b.jpg', type: 'image' },
      ],
      1,
    );
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
