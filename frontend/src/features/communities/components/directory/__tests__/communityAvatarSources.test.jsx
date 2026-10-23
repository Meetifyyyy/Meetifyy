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
  return { getMediaUrl, deriveThumbnailKey: media.deriveThumbnailKey };
});

const { default: CommunityAvatar } = await import('../CommunityAvatar');

const img = (c) => c.querySelector('img');

describe('CommunityAvatar', () => {
  afterEach(cleanup);

  it('loads the thumbnail straight from the public host, which is what survives offline', () => {
    const { container } = render(<CommunityAvatar community={{ name: 'Chess', avatarKey: 'community-icons/c1.webp' }} />);
    expect(img(container).getAttribute('src')).toBe('https://cdn.example.test/community-icons/c1_thumb.webp');
  });

  it('falls back to the direct original, then the API, then the initial', () => {
    const { container } = render(<CommunityAvatar community={{ name: 'Chess', avatarKey: 'community-icons/c2.webp' }} />);
    fireEvent.error(img(container));
    expect(img(container).getAttribute('src')).toBe('https://cdn.example.test/community-icons/c2.webp');
    fireEvent.error(img(container));
    expect(img(container).getAttribute('src')).toBe('https://api.example.test/api/media/community-icons/c2_thumb.webp');
    fireEvent.error(img(container));
    expect(img(container)).toBeNull();
    expect(container.textContent).toBe('C');
  });

  it('does not ask for a thumbnail the host was already found not to have', () => {
    const community = { name: 'Go', avatarKey: 'community-icons/c3.webp' };
    const first = render(<CommunityAvatar community={community} />);
    fireEvent.error(img(first.container));
    first.unmount();
    const { container } = render(<CommunityAvatar community={community} />);
    expect(img(container).getAttribute('src')).toBe('https://cdn.example.test/community-icons/c3.webp');
  });
});
