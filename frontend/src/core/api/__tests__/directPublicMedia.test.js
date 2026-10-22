import { describe, it, expect } from 'vitest';
import { directPublicMediaUrl, DIRECT_PUBLIC_FOLDERS } from '../media';

const CDN = 'https://cdn.example.test';

describe('directPublicMediaUrl', () => {
  it('builds the public address for an avatar key in every stored shape', () => {
    expect(directPublicMediaUrl('avatars/a1.webp', CDN)).toBe(`${CDN}/avatars/a1.webp`);
    expect(directPublicMediaUrl('/api/media/avatars/a1.webp', CDN)).toBe(`${CDN}/avatars/a1.webp`);
    expect(directPublicMediaUrl('https://api.example.test/api/media/avatars/a1_thumb.webp', `${CDN}/`))
      .toBe(`${CDN}/avatars/a1_thumb.webp`);
  });

  it('never addresses private or unlisted folders directly', () => {
    for (const key of ['chat/x.webp', 'messages/x.webp', 'voice/x.webm', 'support/x.png', 'verification/x.jpg', 'posts/x.webp']) {
      expect(directPublicMediaUrl(key, CDN)).toBeNull();
      expect(directPublicMediaUrl(`/api/media/${key}`, CDN)).toBeNull();
    }
    expect(DIRECT_PUBLIC_FOLDERS).toEqual(['avatars']);
  });

  it('falls back (null) without a usable public origin', () => {
    expect(directPublicMediaUrl('avatars/a.webp', '')).toBeNull();
    expect(directPublicMediaUrl('avatars/a.webp', undefined)).toBeNull();
    expect(directPublicMediaUrl('avatars/a.webp', 'http://cdn.example.test')).toBeNull();
  });

  it('rejects anything that is not one safe folder/name key', () => {
    expect(directPublicMediaUrl('avatars/../chat/x.webp', CDN)).toBeNull();
    expect(directPublicMediaUrl('avatars/sub/x.webp', CDN)).toBeNull();
    expect(directPublicMediaUrl('avatars/..', CDN)).toBeNull();
    expect(directPublicMediaUrl('https://other.test/avatars/x.webp', CDN)).toBeNull();
    expect(directPublicMediaUrl('data:image/png;base64,AA', CDN)).toBeNull();
    expect(directPublicMediaUrl('//evil.test/avatars/x.webp', CDN)).toBeNull();
  });
});
