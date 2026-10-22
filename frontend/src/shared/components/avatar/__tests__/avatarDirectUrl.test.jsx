// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@config', async (orig) => {
  const actual = await orig();
  return { ...actual, config: { ...actual.config, storage: { publicUrl: 'https://cdn.example.test' } } };
});
vi.mock('@shared/api/apiClient', async () => {
  const media = await import('@core/api/media');
  const { getMediaUrl } = media.createMediaUrls({
    apiOrigin: { privateMediaTarget: () => null },
    getBackendUrl: () => 'https://api.example.test',
  });
  return {
    getMediaUrl,
    normalizeDicebearUrl: media.normalizeDicebearUrl,
    deriveThumbnailKey: media.deriveThumbnailKey,
  };
});
vi.mock('@shared/hooks/usePresenceVisibility', () => ({ useCanSeeOthersPresence: () => true }));

const { default: Avatar } = await import('../Avatar');

const img = (c) => c.querySelector('img');

describe('Avatar loads public avatars straight from the media host', () => {
  afterEach(cleanup);

  it('skips the API hop for an avatar key', () => {
    const { container } = render(<Avatar src="avatars/p1.webp" size={120} />);
    expect(img(container).getAttribute('src')).toBe('https://cdn.example.test/avatars/p1.webp');
  });

  it('uses the direct thumbnail, then the direct original, then the API', () => {
    const { container } = render(<Avatar src="avatars/p2.webp" size={32} />);
    expect(img(container).getAttribute('src')).toBe('https://cdn.example.test/avatars/p2_thumb.webp');
    fireEvent.error(img(container));
    expect(img(container).getAttribute('src')).toBe('https://cdn.example.test/avatars/p2.webp');
    fireEvent.error(img(container));
    expect(img(container).getAttribute('src')).toBe('https://api.example.test/api/media/avatars/p2.webp');
    fireEvent.error(img(container));
    expect(img(container)).toBeNull();
  });

  it('remembers a missing direct thumbnail for the session', () => {
    const first = render(<Avatar src="avatars/p3.webp" size={32} />);
    fireEvent.error(img(first.container));
    first.unmount();
    const again = render(<Avatar src="avatars/p3.webp" size={32} />);
    expect(img(again.container).getAttribute('src')).toBe('https://cdn.example.test/avatars/p3.webp');
  });

  it('keeps every non-avatar key on the API', () => {
    const { container } = render(<Avatar src="groups/g1.webp" size={120} />);
    expect(img(container).getAttribute('src')).toBe('https://api.example.test/api/media/groups/g1.webp');
  });
});
