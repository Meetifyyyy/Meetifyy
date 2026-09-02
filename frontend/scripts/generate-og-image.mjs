/**
 * Renders `public/og/meetifyy-og.png`, the image every shared Meetifyy link
 * unfurls with.
 *
 * Generated rather than committed for the same reason the PWA icons are: it is
 * derived from `assets-src/logo-master.png` and the wordmark, so a brand change
 * updates it by rebuilding instead of by remembering.
 *
 * WHY THE CARD IS BUILT FROM ARTWORK, NOT TEXT
 * Composing the wordmark image rather than setting type in SVG means the result
 * does not depend on which fonts happen to be installed on the build machine.
 * A CI runner without the brand font would silently substitute a default and
 * ship an off-brand card, and nobody would notice until someone shared a link.
 *
 * 1200x630 is the size Open Graph, Twitter/X `summary_large_image`, LinkedIn
 * and Slack all crop from cleanly. Anything smaller is upscaled by the unfurler.
 */
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const WIDTH = 1200;
const HEIGHT = 630;

// The launch shell, the PWA `background_color` and this card are all #FDFDFD on
// purpose: a shared link, the splash screen and the first paint are the same
// colour, so the brand reads as one surface across all three.
const BG = '#FDFDFD';
const BRAND = '#2563EB';

/**
 * Background plate.
 *
 * Two very soft brand-tinted radials rather than a flat fill. A pure white card
 * looks unfinished next to other previews in a feed; a heavy gradient looks
 * like a template. These sit at 10% and 7% alpha, which reads as depth rather
 * than as colour.
 */
const background = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <radialGradient id="glowA" cx="0.5" cy="0.12" r="0.75">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.88" cy="1" r="0.7">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowA)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowB)"/>
  <rect x="0" y="${HEIGHT - 6}" width="${WIDTH}" height="6" fill="${BRAND}"/>
</svg>
`);

// The vector wordmark, not `wordmark.png` and not `logo-master.png`. Both of
// those raster files have a white plate baked into the artwork, which composites
// onto the gradient as a visible white box. The SVG is the mark itself with
// nothing behind it, and being vector it stays crisp at card size.
const WORDMARK_WIDTH = 620;
const WORDMARK_SRC = resolve(root, 'src/assets/images/meetifyy_wordmark.svg');

async function main() {
  const wordmark = await sharp(WORDMARK_SRC, { density: 600 })
    .resize({ width: WORDMARK_WIDTH, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const wordmarkHeight = (await sharp(wordmark).metadata()).height;

  // Nudged fractionally above true centre. A block sitting on the exact vertical
  // midpoint reads as slightly low, because the eye takes the optical centre to
  // be a little above the geometric one.
  const top = Math.round((HEIGHT - wordmarkHeight) / 2) - 8;

  const outputPath = resolve(root, 'public/og/meetifyy-og.png');
  mkdirSync(dirname(outputPath), { recursive: true });

  await sharp(background)
    .composite([
      { input: wordmark, top, left: Math.round((WIDTH - WORDMARK_WIDTH) / 2) },
    ])
    // Flattened to the card colour: an OG image with transparency is
    // composited onto whatever the unfurler uses, which is black in Slack's
    // dark theme and would put a dark card behind a dark wordmark.
    .flatten({ background: BG })
    // No `palette: true`. Quantising to 256 colours banded the soft radials
    // into visible rings, which is the one thing a gradient this subtle cannot
    // survive. Full-colour PNG at this size is still well inside the 8 MB that
    // every unfurler accepts.
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  const { width, height } = await sharp(outputPath).metadata();
  const bytes = statSync(outputPath).size;
  console.log(`[og] public/og/meetifyy-og.png  ${width}x${height}  ${Math.round(bytes / 1024)} KB`);
}

main().catch((error) => {
  console.error('[og] failed:', error.message);
  process.exit(1);
});
