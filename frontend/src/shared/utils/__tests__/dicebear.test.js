import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_DICEBEAR_STYLES,
  DICEBEAR_STYLE_LABELS,
  getDiceBearAvatar,
  buildDicebearUrl,
  getDeterministicUserAvatar,
  generateRandomAvatarSet,
  generateCategoryAvatars,
  generateAvatarCollection,
} from '../dicebear';

describe('DiceBear Avatar Utility', () => {
  it('strictly limits supported styles to the 6 approved styles', () => {
    expect(SUPPORTED_DICEBEAR_STYLES).toEqual([
      'adventurer',
      'adventurer-neutral',
      'critters',
      'big-smile',
      'fun-emoji',
      'voxel-art',
    ]);
    expect(Object.keys(DICEBEAR_STYLE_LABELS)).toEqual([
      'adventurer',
      'adventurer-neutral',
      'critters',
      'big-smile',
      'fun-emoji',
      'voxel-art',
    ]);
  });

  it('builds a valid DiceBear 10.x URL with background color and memoizes results', () => {
    const url1 = getDiceBearAvatar({
      style: 'adventurer',
      seed: 'Felix',
      backgroundColor: 'b6e3f4',
    });

    const url2 = buildDicebearUrl({
      style: 'adventurer',
      seed: 'Felix',
      backgroundColor: 'b6e3f4',
    });

    expect(url1).toBe('https://api.dicebear.com/10.x/adventurer/svg?seed=Felix&backgroundColor=b6e3f4');
    expect(url1).toBe(url2); // Same reference from memoization cache
  });

  it('falls back to adventurer if an unknown style is provided', () => {
    const url = getDiceBearAvatar({
      style: 'unknown-style',
      seed: 'Test',
      backgroundColor: 'c0aede',
    });

    expect(url).toContain('https://api.dicebear.com/10.x/adventurer/svg');
  });

  it('generates deterministic user avatars without random fluctuations', () => {
    const user = { id: 'usr_abc123', email: 'alex@stanford.edu', name: 'Alex' };
    const urlA = getDeterministicUserAvatar(user, 'adventurer');
    const urlB = getDeterministicUserAvatar(user, 'adventurer');

    expect(urlA).toBe(urlB);
    expect(urlA).toContain('seed=usr_abc123');
    expect(urlA).toContain('backgroundColor=');
  });

  it('generates a lightweight set of 5 quick avatars for Step 5', () => {
    const avatars = generateRandomAvatarSet(5);

    expect(avatars).toHaveLength(5);

    const urls = new Set();
    avatars.forEach((avatar) => {
      expect(SUPPORTED_DICEBEAR_STYLES).toContain(avatar.style);
      expect(avatar.url).toMatch(/^https:\/\/api\.dicebear\.com\/10\.x\/[a-z-]+\/svg\?seed=.+&backgroundColor=[a-f0-9]+$/i);
      urls.add(avatar.url);
    });

    // Verify all 5 URLs are distinct
    expect(urls.size).toBe(5);
  });

  it('generates avatars scoped strictly to a single category', () => {
    const crittersAvatars = generateCategoryAvatars('critters', 20);

    expect(crittersAvatars).toHaveLength(20);
    crittersAvatars.forEach((avatar) => {
      expect(avatar.style).toBe('critters');
      expect(avatar.url).toContain('https://api.dicebear.com/10.x/critters/svg');
    });
  });

  it('generates an initial mixed collection covering all 6 styles (8 per style)', () => {
    const collection = generateAvatarCollection(8);

    expect(collection).toHaveLength(48); // 6 styles * 8 count = 48

    const stylesInCollection = new Set(collection.map((a) => a.style));
    expect(stylesInCollection.size).toBe(6);
    SUPPORTED_DICEBEAR_STYLES.forEach((s) => {
      expect(stylesInCollection.has(s)).toBe(true);
    });
  });
});
