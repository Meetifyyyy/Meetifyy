import { describe, it, expect } from 'vitest';
import {
  getPresetAmbientRgb,
  parseHexRgb,
  getDeterministicAmbientRgb,
  resolveAmbientRgb,
  THEME_AMBIENT_RGBS,
  PRESET_IMAGE_RGB_MAP,
  DEFAULT_AMBIENT_RGB,
} from '../ambientColor';

describe('ambientColor utility', () => {
  it('parses hex colors correctly', () => {
    expect(parseHexRgb('#2563eb')).toBe('37, 99, 235');
    expect(parseHexRgb('#ff0000')).toBe('255, 0, 0');
    expect(parseHexRgb('10b981')).toBe('16, 185, 129');
    expect(parseHexRgb('invalid')).toBeNull();
    expect(parseHexRgb('')).toBeNull();
  });

  it('matches preset image URLs to specific and theme RGBs', () => {
    const partyUrl = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-4.webp';
    expect(getPresetAmbientRgb(partyUrl)).toBe(PRESET_IMAGE_RGB_MAP['img-party-4']);

    const genericParty = 'https://example.com/party-celebration.jpg';
    expect(getPresetAmbientRgb(genericParty)).toBe(THEME_AMBIENT_RGBS.party);

    const codingUrl = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-coding-img-code-1.webp';
    expect(getPresetAmbientRgb(codingUrl)).toBe(PRESET_IMAGE_RGB_MAP['img-code-1']);
  });

  it('resolves ambient RGB for preset image immediately without network or CORS', async () => {
    const rgb = await resolveAmbientRgb({
      coverImage: 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-4.webp',
      coverMode: 'image',
    });
    expect(rgb).toBe('124, 58, 237');
  });

  it('resolves ambient RGB for solid color mode', async () => {
    const rgb = await resolveAmbientRgb({
      coverColor: '#10b981',
      coverMode: 'color',
    });
    expect(rgb).toBe('16, 185, 129');
  });

  it('resolves deterministic ambient RGB for external URLs', async () => {
    const rgb = await resolveAmbientRgb({
      coverImage: 'https://images.unsplash.com/photo-123456789',
      coverMode: 'image',
    });
    expect(rgb).toBeTruthy();
    expect(rgb.split(',').length).toBe(3);
  });

  it('falls back to default RGB when no cover is provided', async () => {
    const rgb = await resolveAmbientRgb({});
    expect(rgb).toBe(DEFAULT_AMBIENT_RGB);
  });
});
