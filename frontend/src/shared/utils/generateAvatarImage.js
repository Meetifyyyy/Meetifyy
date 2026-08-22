/**
 * Renders a lettered avatar to a real image file.
 *
 * Communities without an uploaded picture used to be drawn on the fly wherever
 * they appeared — a coloured div with the first letter of the name. That works
 * visually but leaves the community with no avatar at all: nothing to send in a
 * share payload, nothing for a notification or an OG image, and every surface has
 * to re-implement the same fallback. Producing an actual image once, at creation,
 * means a community always has a real avatar URL and every consumer just renders
 * it like any other picture.
 *
 * Canvas-based on purpose: it reuses the browser the user is already in rather
 * than adding an image-rendering dependency to the backend, and the result goes
 * through the same upload pipeline as a picture the user chose.
 */

/** Default square size. 512 matches the compression cap used for avatars. */
const DEFAULT_SIZE = 512;

/**
 * Pulls the colour stops out of a CSS gradient string such as
 * `linear-gradient(135deg, #FF6B6B, #FF8E53)`.
 *
 * Only hex stops are read, which is all the community palette uses. A string with
 * one usable colour renders as a flat fill; none at all falls back to the theme
 * blue so the caller still gets an image rather than an exception.
 *
 * @param {string} css
 * @returns {string[]} one or more hex colours
 */
export function parseGradientStops(css) {
  const stops = String(css || '').match(/#(?:[0-9a-f]{3,8})/gi) || [];
  if (stops.length === 0) return ['#2563eb'];
  return stops;
}

/** The letter shown for a name, or '?' when there is nothing usable. */
export function initialFor(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '?';
  // Works for non-Latin names too: take the first visual character rather than
  // the first UTF-16 code unit, so an emoji or surrogate pair is not split.
  const [first] = Array.from(trimmed);
  return (first || '?').toUpperCase();
}

/**
 * Draws `name`'s initial on `gradientCss` and returns it as an image File.
 *
 * @param {string} name          community (or entity) name
 * @param {string} gradientCss   a CSS linear-gradient, or any string containing hex stops
 * @param {{ size?: number, fileNameBase?: string }} [options]
 * @returns {Promise<File>} resolves with a PNG/WebP File ready for upload
 * @throws  when the environment has no usable canvas, or encoding fails
 */
export async function generateInitialAvatarFile(name, gradientCss, options = {}) {
  const { size = DEFAULT_SIZE, fileNameBase = 'community-avatar' } = options;

  if (typeof document === 'undefined' || !document.createElement) {
    throw new Error('Canvas is unavailable in this environment');
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire a 2D canvas context');

  // Diagonal, matching the palette's `135deg` (CSS 135deg runs top-left to
  // bottom-right, which is this canvas axis).
  const stops = parseGradientStops(gradientCss);
  const fill = ctx.createLinearGradient(0, 0, size, size);
  if (stops.length === 1) {
    fill.addColorStop(0, stops[0]);
    fill.addColorStop(1, stops[0]);
  } else {
    stops.forEach((color, i) => fill.addColorStop(i / (stops.length - 1), color));
  }
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);

  // Square, not pre-clipped to a circle: the UI already masks avatars round where
  // it wants them, and a square source stays correct in the places that don't.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(size * 0.44)}px "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif`;
  // Nudged down a touch: `middle` sits on the em box, which reads high for capitals.
  ctx.fillText(initialFor(name), size / 2, size / 2 + size * 0.02);

  const blob = await new Promise((resolve) => {
    // WebP first for size; browsers that cannot encode it hand back a PNG, which
    // is why the resulting type is read back rather than assumed.
    try {
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.92);
    } catch {
      resolve(null);
    }
  });

  const finalBlob = blob || await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  if (!finalBlob) throw new Error('Canvas produced no image data');

  const type = finalBlob.type || 'image/png';
  const ext = type === 'image/webp' ? 'webp' : 'png';
  return new File([finalBlob], `${fileNameBase}.${ext}`, { type });
}
