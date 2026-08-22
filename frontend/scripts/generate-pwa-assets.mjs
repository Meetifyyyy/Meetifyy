/**
 * Generates every PWA launch asset from one master logo.
 *
 * Run `npm run pwa:assets` after changing the logo or the launch colour.
 *
 * `assets-src/logo-master.png` is the untouched source and is never written to, so
 * the script is idempotent — re-running it cannot compound rounding or rescale
 * an already-scaled image.
 *
 * Three families come out of it:
 *
 * - `logo-{size}.png` — `purpose: any`. Rounded corners, transparent outside
 *   them. Used where the platform does no masking of its own.
 *
 * - `logo-{size}-maskable.png` — `purpose: maskable`, which is a promise to the
 *   platform that it may crop the image to any shape and still have something
 *   sensible left. These must be opaque edge to edge with all content inside the
 *   central 80% safe circle. The previous ones were the plain logo tile, which
 *   has transparent corners, so Android's circular crop cut into the
 *   transparency and filled it black — the ring of black arcs around the logo on
 *   the Android splash.
 *
 * - `splash/apple-splash-*.png` — iOS shows a blank screen on launch unless
 *   given an `apple-touch-startup-image` matching the device exactly.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
// Outside `public/` on purpose: it is a build input, not a runtime asset, so it
// should be neither served nor swept into the service worker's precache.
const MASTER = path.resolve(HERE, '../assets-src/logo-master.png');

/**
 * The launch background.
 *
 * #FDFDFD rather than #FFFFFF because that is the logo tile's own background.
 * Two points of difference is nothing on its own, but it is enough to make the
 * tile's edge visible as a faint square outline on a pure-white field. Matching
 * it exactly means the mark reads as floating on the screen. Keep the manifest's
 * `background_color` and the launch shell in index.html in step with this.
 */
const LAUNCH_BG = '#FDFDFD';

/**
 * Corner radius of the `any` icons, as a fraction of their width. iOS-squircle
 * territory — noticeably rounder than the ~4% the master ships with, without
 * going full circle.
 */
const CORNER_RADIUS = 0.24;

/**
 * The logo lockup is wide and short (its ink is ~75% x ~46% of the tile), so its
 * corners sit further from the centre than its height suggests: at full size the
 * ink's half-diagonal is ~230px on a 512 icon, outside the 205px safe radius.
 * 0.85 brings it inside with room to spare.
 */
const MASKABLE_LOGO_SCALE = 0.85;

const roundedRectMask = (size, radius) => Buffer.from(
  `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
);

/** `purpose: any` — rounded, with the corners cut out to transparency. */
async function anyIcon(size) {
  const flattened = await sharp(MASTER)
    .resize(size)
    .flatten({ background: LAUNCH_BG }) // fill the master's own transparent corners first
    .png()
    .toBuffer();

  return sharp(flattened)
    .composite([{ input: roundedRectMask(size, Math.round(size * CORNER_RADIUS)), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(PUBLIC, `logo-${size}.png`));
}

/** `purpose: maskable` — opaque to the edge, content inside the safe circle. */
async function maskableIcon(size) {
  const logo = await sharp(MASTER)
    .resize(Math.round(size * MASKABLE_LOGO_SCALE))
    .png()
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background: LAUNCH_BG } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(PUBLIC, `logo-${size}-maskable.png`));
}

/**
 * One entry per real iOS device geometry. `w`/`h` are CSS pixels and `r` the
 * device pixel ratio — the media query has to match all three or iOS ignores the
 * image and falls back to a blank screen.
 */
const IOS_SCREENS = [
  { w: 430, h: 932, r: 3 },   // iPhone 14/15/16 Pro Max
  { w: 428, h: 926, r: 3 },   // iPhone 12/13/14 Pro Max
  { w: 414, h: 896, r: 3 },   // iPhone XS Max, 11 Pro Max
  { w: 414, h: 896, r: 2 },   // iPhone XR, 11
  { w: 414, h: 736, r: 3 },   // iPhone 8 Plus
  { w: 393, h: 852, r: 3 },   // iPhone 14/15/16 Pro
  { w: 390, h: 844, r: 3 },   // iPhone 12/13/14
  { w: 375, h: 812, r: 3 },   // iPhone X, XS, 11 Pro
  { w: 375, h: 667, r: 2 },   // iPhone 8, SE 2nd/3rd gen
  { w: 320, h: 568, r: 2 },   // iPhone SE 1st gen
  { w: 1024, h: 1366, r: 2 }, // iPad Pro 12.9"
  { w: 834, h: 1194, r: 2 },  // iPad Pro 11"
  { w: 834, h: 1112, r: 2 },  // iPad Pro 10.5"
  { w: 820, h: 1180, r: 2 },  // iPad Air
  { w: 768, h: 1024, r: 2 },  // iPad Mini / 9.7"
];

export const iosStartupName = ({ w, h, r }) => `splash/apple-splash-${w}x${h}@${r}x.png`;

async function iosStartupImage(screen) {
  const width = screen.w * screen.r;
  const height = screen.h * screen.r;

  // A consistent visual size across very different screens: proportional to the
  // narrow edge, then clamped so it is neither lost on an iPad nor crowding the
  // edges of an SE.
  const logoSize = Math.round(Math.min(Math.max(Math.min(width, height) * 0.42, 220), 520));
  const logo = await sharp(MASTER).resize(logoSize).png().toBuffer();

  return sharp({ create: { width, height, channels: 4, background: LAUNCH_BG } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(PUBLIC, iosStartupName(screen)));
}

async function main() {
  await mkdir(path.join(PUBLIC, 'splash'), { recursive: true });

  await Promise.all([
    anyIcon(512),
    anyIcon(192),
    maskableIcon(512),
    maskableIcon(192),
    ...IOS_SCREENS.map(iosStartupImage),
  ]);

  console.log(`Wrote 2 icons, 2 maskable icons and ${IOS_SCREENS.length} iOS startup images.`);
}

export { IOS_SCREENS, LAUNCH_BG };

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
