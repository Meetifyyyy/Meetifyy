import { describe, it, expect, vi, beforeEach } from 'vitest';

// getMediaUrl reads window.location and the Supabase client; stub it to the one
// behaviour under test — turning a bare object key into an absolute media URL.
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (v) => (/^(https?:|data:|blob:)/.test(v) ? v : `https://api.test/api/media/${v.replace(/^\/+/, '')}`),
}));

let resolveCommunityAvatar;
beforeEach(async () => {
  ({ resolveCommunityAvatar } = await import('../avatar'));
});

describe('resolveCommunityAvatar', () => {
  it('reads avatarKey — the column the image is actually stored in', () => {
    // The bug: CommunityView read `comm.avatar`, and Community has no such
    // column, so the hero avatar always fell through to the coloured initial.
    expect(resolveCommunityAvatar({ avatarKey: 'community-icons/abc.webp' }))
      .toBe('https://api.test/api/media/community-icons/abc.webp');
  });

  it('resolves the key to an absolute URL rather than a route-relative one', () => {
    // A bare key in `src` resolves against the current route — /crew/foo.webp —
    // so the same avatar loaded on one screen and 404'd on another.
    const url = resolveCommunityAvatar({ avatarKey: 'community-icons/abc.webp' });
    expect(url.startsWith('https://')).toBe(true);
  });

  it('falls back to `avatar` when that is the field that is populated', () => {
    expect(resolveCommunityAvatar({ avatar: 'community-icons/x.png' }))
      .toBe('https://api.test/api/media/community-icons/x.png');
  });

  it('prefers avatarKey when both are present', () => {
    expect(resolveCommunityAvatar({ avatarKey: 'a/key.webp', avatar: 'b/other.webp' }))
      .toContain('a/key.webp');
  });

  it('passes an absolute URL straight through', () => {
    expect(resolveCommunityAvatar({ avatarKey: 'https://cdn.example/x.png' }))
      .toBe('https://cdn.example/x.png');
  });

  it('returns null for a legacy row that stored a bare initial', () => {
    // Otherwise "H" becomes a media request for a file named H.
    expect(resolveCommunityAvatar({ avatarKey: 'H' })).toBeNull();
  });

  it('returns null when there is no picture, so the caller draws its initial', () => {
    expect(resolveCommunityAvatar({})).toBeNull();
    expect(resolveCommunityAvatar(null)).toBeNull();
    expect(resolveCommunityAvatar({ avatarKey: '' })).toBeNull();
  });

  it('returns null for a value that is not an image reference at all', () => {
    expect(resolveCommunityAvatar({ avatarKey: 'not an image' })).toBeNull();
  });
});
