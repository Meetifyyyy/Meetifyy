/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ grant: true, observe: null }));

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getUrl: async (u) => u, getSyncUrl: () => null, invalidate: () => {} },
}));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => u,
  deriveThumbnailKey: () => null,
}));
vi.mock('@shared/utils/feedVideoRegistry', () => ({
  feedVideoRegistry: {
    register: () => () => {},
    requestPlay: vi.fn(() => h.grant),
    notifyPause: vi.fn(),
  },
}));

const { default: MediaGrid } = await import('../MediaGrid');
const { feedVideoRegistry } = await import('@shared/utils/feedVideoRegistry');

let play;
beforeEach(() => {
  h.grant = true;
  h.observe = null;
  globalThis.IntersectionObserver = class {
    constructor(cb) { h.observe = cb; }
    observe() {} unobserve() {} disconnect() {}
  };
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const VIDEO = [{ url: 'https://x/v.mp4', type: 'video', width: 800, height: 450, aspectRatio: 16 / 9 }];

async function startInline() {
  render(<MediaGrid media={VIDEO} authorName="Ann" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play video by Ann' })); });
  expect(h.observe).toBeTypeOf('function');
}

describe('feed video autoplay respects the playback registry', () => {
  it('starts when it is visible and the registry grants it', async () => {
    await startInline();
    await act(async () => { h.observe([{ intersectionRatio: 0.9 }]); });
    expect(feedVideoRegistry.requestPlay).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
  });

  it('does not start when the registry refuses (something ranked higher is playing)', async () => {
    h.grant = false;
    await startInline();
    await act(async () => { h.observe([{ intersectionRatio: 0.9 }]); });
    expect(feedVideoRegistry.requestPlay).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });
});
