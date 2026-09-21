/**
 * Generates the Android launcher icons from the brand logo.
 *
 * Run with `npm run mobile:icons`. Rerun it whenever the logo changes; the
 * output is committed, because the native projects are committed.
 *
 * WHY THE MARK AND NOT THE WHOLE LOGO
 * `public/logo-512.png` is the logo lockup: the M mark above the word
 * "MEETIFYY". A launcher icon is rendered at 48dp on an mdpi phone, where that
 * wordmark is about six pixels tall and reads as a grey smudge. Every platform
 * icon guideline says the same thing for the same reason, so this crops to the
 * mark and drops the text. The mark's bounding box is measured from the source
 * rather than hard-coded, so a redrawn logo does not silently shift the icon
 * off-centre.
 *
 * THE THREE OUTPUTS ARE NOT INTERCHANGEABLE
 *   - `ic_launcher`          legacy square, full bleed, for pre-Android-8.
 *   - `ic_launcher_round`    legacy circle, for launchers that ask for one.
 *   - `ic_launcher_foreground` the adaptive icon's foreground layer. Its canvas
 *     is 108dp but only the middle 72dp is guaranteed visible — the launcher
 *     masks the rest to whatever shape it likes, and animates it on some
 *     devices. Art drawn to the edge gets its corners eaten. Hence SAFE_RATIO.
 *
 * The adaptive background stays the white in `values/ic_launcher_background.xml`,
 * which is the logo's own background colour, so the mark sits on white on every
 * mask shape.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');
const SOURCE = resolve(frontend, 'public/logo-512.png');
const RES = resolve(frontend, 'android/app/src/main/res');

/** Legacy icon sizes, in px, by density bucket. */
const LEGACY = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

/** Adaptive foreground is 108dp, so each bucket is 2.25x its legacy size. */
const FOREGROUND = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

/**
 * How much of each canvas the mark occupies.
 *
 * The adaptive one is well inside the 72/108 (0.667) guaranteed-visible zone:
 * filling the safe zone exactly leaves the mark touching the mask edge on a
 * circular launcher, which looks like a mistake rather than a choice.
 */
const SAFE_RATIO = 0.46;
const LEGACY_RATIO = 0.58;

/**
 * The mark on its own, written to `public/` for the web layer to use.
 *
 * The launch shell in index.mobile.html shows this while the WebView boots,
 * immediately after the system splash has shown the SAME mark at roughly the
 * same size. Using the full logo lockup there instead made the handover
 * visible: the mark was replaced by mark-plus-wordmark at the moment the page
 * painted, which reads as a flicker even though nothing was actually wrong.
 */
const MARK_PUBLIC_PATH = resolve(frontend, 'public/logo-mark.png');
const MARK_PUBLIC_SIZE = 512;

/**
 * The PWA's maskable icons.
 *
 * A maskable icon is cropped by the OS to whatever shape it likes, and only the
 * inner circle of 80% diameter is guaranteed to survive. Anything outside that
 * is cut. The previous pair were drawn near-full-bleed, so on an Android home
 * screen the mark came out cropped and looking zoomed in.
 *
 * 0.42 puts the mark comfortably inside the safe circle on every mask shape.
 * That looks small measured against the PNG and correct measured against what
 * is actually on screen, which is the only measurement that counts.
 *
 * The non-maskable `logo-192.png` / `logo-512.png` are deliberately NOT touched:
 * they are the `purpose: "any"` icons, they are not cropped, and `logo-512.png`
 * is this script's own source image.
 */
const MASKABLE_RATIO = 0.42;
const MASKABLE = {
  'public/logo-192-maskable.png': 192,
  'public/logo-512-maskable.png': 512,
};

/** Finds the mark's bounding box: the ink above the wordmark. */
async function findMarkBox() {
  const { data, info } = await sharp(SOURCE)
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const isInk = (i) => data[i] < 225 || data[i + 1] < 225 || data[i + 2] < 225;

  // Rows that contain ink, as contiguous bands. The lockup gives two: the mark,
  // then the wordmark under it. Taking the FIRST band is what drops the text.
  const bands = [];
  let current = null;
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (isInk((y * width + x) * channels)) count++;
    const on = count > 2; // a couple of stray pixels is noise, not a band
    if (!current || current.on !== on) {
      if (current) bands.push(current);
      current = { on, from: y, to: y };
    } else {
      current.to = y;
    }
  }
  if (current) bands.push(current);

  const inked = bands.filter((b) => b.on);
  if (inked.length < 2) {
    throw new Error(
      `Expected the logo to contain a mark and a wordmark as separate ink bands; ` +
        `found ${inked.length}. Check ${SOURCE} before trusting this crop.`,
    );
  }

  // The tallest band is the mark. Not "the first": the source has rounded
  // corners whose antialiasing can register as a thin band of its own.
  const mark = inked.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));

  let minX = Infinity;
  let maxX = -1;
  for (let y = mark.from; y <= mark.to; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk((y * width + x) * channels)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  return {
    left: minX,
    top: mark.from,
    width: maxX - minX + 1,
    height: mark.to - mark.from + 1,
  };
}

/** The mark alone, on transparency, trimmed to its own edges. */
async function markBuffer(box) {
  return sharp(SOURCE).extract(box).png().toBuffer();
}

/** A centred mark on `background`, at `ratio` of the canvas. */
async function compose(mark, box, canvas, ratio, background) {
  const scale = (canvas * ratio) / Math.max(box.width, box.height);
  const w = Math.round(box.width * scale);
  const h = Math.round(box.height * scale);
  const resized = await sharp(mark).resize(w, h).png().toBuffer();

  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background,
    },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Masks a square image to a circle, for `ic_launcher_round`. */
async function toCircle(buffer, size) {
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(buffer)
    .composite([{ input: circle, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Source logo not found: ${SOURCE}`);
    process.exit(1);
  }

  const box = await findMarkBox();
  console.log(
    `mark found at ${box.left},${box.top} ${box.width}x${box.height} — wordmark excluded`,
  );

  const mark = await markBuffer(box);
  const white = { r: 255, g: 255, b: 255, alpha: 1 };
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  let written = 0;

  for (const [bucket, size] of Object.entries(LEGACY)) {
    const dir = resolve(RES, bucket);
    mkdirSync(dir, { recursive: true });

    const square = await compose(mark, box, size, LEGACY_RATIO, white);
    writeFileSync(resolve(dir, 'ic_launcher.png'), square);
    writeFileSync(resolve(dir, 'ic_launcher_round.png'), await toCircle(square, size));
    written += 2;
  }

  for (const [bucket, size] of Object.entries(FOREGROUND)) {
    const dir = resolve(RES, bucket);
    mkdirSync(dir, { recursive: true });
    // Transparent, not white: the adaptive BACKGROUND layer supplies the colour,
    // and an opaque foreground would defeat the parallax the launcher applies.
    const fg = await compose(mark, box, size, SAFE_RATIO, clear);
    writeFileSync(resolve(dir, 'ic_launcher_foreground.png'), fg);
    written += 1;
  }

  // Padded to the same proportion as the adaptive foreground, so the shell logo
  // and the splash icon are the same size on screen and nothing moves between
  // them.
  const publicMark = await compose(mark, box, MARK_PUBLIC_SIZE, SAFE_RATIO, clear);
  writeFileSync(MARK_PUBLIC_PATH, publicMark);

  // Opaque, unlike every other output here: a maskable icon has no transparency
  // to fall back on — the OS fills the whole tile, and a transparent one is
  // rendered against an arbitrary colour it was never designed for.
  for (const [rel, size] of Object.entries(MASKABLE)) {
    const maskable = await compose(mark, box, size, MASKABLE_RATIO, white);
    writeFileSync(resolve(frontend, rel), maskable);
  }

  console.log(`wrote ${written} icon files under android/app/src/main/res/`);
  console.log('wrote public/logo-mark.png for the launch shell');
  console.log(`wrote ${Object.keys(MASKABLE).length} maskable PWA icons at ${MASKABLE_RATIO} of canvas`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
