/**
 * Ambient Color Extraction Utility
 * 
 * Extracts or derives vibrant RGB values for background ambient glows and cards.
 * Avoids any crossOrigin CORS errors by:
 * 1. Providing instant 0ms, zero-network RGB mappings for all Cloudflare R2 preset media & themes.
 * 2. Directly decoding hex solid colors.
 * 3. Safely reading same-origin blob: and data: URLs via offscreen canvas.
 * 4. Deterministically deriving harmonious palette colors for external URLs without triggering CORS fetch failures.
 */

// Preset theme default RGBs (RGB tuples as 'r, g, b')
export const THEME_AMBIENT_RGBS = {
  party: '168, 85, 247',      // Violet / Fuchsia
  adventure: '16, 185, 129',   // Emerald
  study: '79, 70, 229',       // Indigo
  coffee: '217, 119, 6',      // Warm Amber
  walk: '34, 197, 94',        // Spring Green
  coding: '6, 182, 212',      // Cyan
};

// Specific RGBs for individual preset images for richer visual harmony
export const PRESET_IMAGE_RGB_MAP = {
  // Party
  'img-party-1': '147, 51, 234',
  'img-party-2': '219, 39, 119',
  'img-party-3': '234, 88, 12',
  'img-party-4': '124, 58, 237',
  'img-party-5': '99, 102, 241',
  'img-party-6': '225, 29, 72',

  // Adventure
  'img-adv-1': '14, 165, 233',
  'img-adv-2': '16, 185, 129',
  'img-adv-3': '245, 158, 11',
  'img-adv-4': '217, 119, 6',
  'img-adv-5': '6, 182, 212',
  'img-adv-6': '59, 130, 246',

  // Study
  'img-study-1': '180, 83, 9',
  'img-study-2': '79, 70, 229',
  'img-study-3': '99, 102, 241',
  'img-study-4': '34, 197, 94',
  'img-study-5': '59, 130, 246',
  'img-study-6': '217, 119, 6',

  // Coffee
  'img-coffee-1': '217, 119, 6',
  'img-coffee-2': '180, 83, 9',
  'img-coffee-3': '161, 98, 7',
  'img-coffee-4': '194, 65, 12',
  'img-coffee-5': '245, 158, 11',
  'img-coffee-6': '180, 83, 9',

  // Walk
  'img-walk-1': '34, 197, 94',
  'img-walk-2': '234, 88, 12',
  'img-walk-3': '99, 102, 241',
  'img-walk-4': '244, 63, 94',
  'img-walk-5': '16, 185, 129',
  'img-walk-6': '14, 165, 233',

  // Coding
  'img-code-1': '6, 182, 212',
  'img-code-2': '124, 58, 237',
  'img-code-3': '59, 130, 246',
  'img-code-4': '16, 185, 129',
  'img-code-5': '217, 119, 6',
  'img-code-6': '236, 72, 153',
};

// Curated palette for deterministic external URL hashing
const HARMONIOUS_AMBIENT_PALETTE = [
  '124, 58, 237', // Violet
  '37, 99, 235',  // Meetifyy Blue
  '16, 185, 129', // Emerald
  '217, 119, 6',  // Amber
  '225, 29, 72',  // Rose
  '6, 182, 212',  // Cyan
  '192, 38, 211', // Fuchsia
  '79, 70, 229',  // Indigo
];

export const DEFAULT_AMBIENT_RGB = '37, 99, 235';

/**
 * Returns preset ambient RGB if the URL or ID matches a known preset.
 * Synchronous, 0ms, zero-network.
 */
export function getPresetAmbientRgb(urlOrId = '') {
  if (!urlOrId || typeof urlOrId !== 'string') return null;

  const lower = urlOrId.toLowerCase();

  // 1. Direct preset ID matching
  for (const [id, rgb] of Object.entries(PRESET_IMAGE_RGB_MAP)) {
    if (lower.includes(id.toLowerCase())) {
      return rgb;
    }
  }

  // 2. Theme matching
  if (lower.includes('party')) return THEME_AMBIENT_RGBS.party;
  if (lower.includes('adventure') || lower.includes('adv')) return THEME_AMBIENT_RGBS.adventure;
  if (lower.includes('study')) return THEME_AMBIENT_RGBS.study;
  if (lower.includes('coffee')) return THEME_AMBIENT_RGBS.coffee;
  if (lower.includes('walk')) return THEME_AMBIENT_RGBS.walk;
  if (lower.includes('coding') || lower.includes('code')) return THEME_AMBIENT_RGBS.coding;

  return null;
}

/**
 * Parses a hex color string into 'r, g, b'.
 */
export function parseHexRgb(hex = '') {
  if (!hex || typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

/**
 * Deterministically picks a harmonious ambient RGB for an external string/URL.
 */
export function getDeterministicAmbientRgb(seed = '') {
  if (!seed) return DEFAULT_AMBIENT_RGB;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % HARMONIOUS_AMBIENT_PALETTE.length;
  return HARMONIOUS_AMBIENT_PALETTE[index];
}

/**
 * Resolves the ambient RGB tuple ('r, g, b') for a cover configuration.
 *
 * @param {Object} options
 * @param {string} [options.coverImage] - Cover image URL, blob URL, or preset
 * @param {string} [options.coverColor] - Hex color code
 * @param {string} [options.coverMode] - 'color' | 'image'
 * @returns {Promise<string>} RGB tuple formatted as 'r, g, b'
 */
export function resolveAmbientRgb({ coverImage, coverColor, coverMode } = {}) {
  // 1. Color mode
  if (coverMode === 'color' || (!coverImage && coverColor)) {
    const parsed = parseHexRgb(coverColor);
    if (parsed) return Promise.resolve(parsed);
  }

  if (!coverImage || typeof coverImage !== 'string') {
    return Promise.resolve(DEFAULT_AMBIENT_RGB);
  }

  // 2. Preset image / theme fast path (instant, no network, no CORS)
  const presetRgb = getPresetAmbientRgb(coverImage);
  if (presetRgb) {
    return Promise.resolve(presetRgb);
  }

  // 3. Local blob: or data: URL (same-origin canvas sampling)
  if (coverImage.startsWith('blob:') || coverImage.startsWith('data:')) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        // Do NOT set crossOrigin on blob: or data: URLs
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 10;
            canvas.height = 10;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(DEFAULT_AMBIENT_RGB);
            ctx.drawImage(img, 0, 0, 10, 10);
            const data = ctx.getImageData(0, 0, 10, 10).data;

            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count++;
            }
            if (count === 0) return resolve(DEFAULT_AMBIENT_RGB);
            r = Math.round(r / count);
            g = Math.round(g / count);
            b = Math.round(b / count);
            resolve(`${r}, ${g}, ${b}`);
          } catch (_) {
            resolve(DEFAULT_AMBIENT_RGB);
          }
        };
        img.onerror = () => resolve(DEFAULT_AMBIENT_RGB);
        img.src = coverImage;
      } catch (_) {
        resolve(DEFAULT_AMBIENT_RGB);
      }
    });
  }

  // 4. Remote HTTP/HTTPS URL
  // Avoid crossOrigin = 'Anonymous' to prevent browser console CORS network errors on unproxied buckets.
  // Use deterministic ambient color from the URL.
  return Promise.resolve(getDeterministicAmbientRgb(coverImage));
}
