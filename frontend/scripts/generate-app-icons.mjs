/**
 * Generates the Android launcher icons and the shared mark asset from the brand
 * logo.
 *
 * Run with `npm run mobile:icons`. Rerun it whenever the logo changes; the
 * output is committed, because the native projects are committed.
 *
 * THE SOURCE MUST BE THE TRANSPARENT LOGO
 * `src/assets/images/meetify_logo.webp` is the mark on transparency. The
 * earlier version of this script read `public/logo-512.png` instead, which is
 * the same mark sitting on an opaque white plate — 86% of that file is solid
 * white. Cropping the mark out of it therefore carried a white RECTANGLE along
 * with it, tight to the mark's bounding box, and that rectangle was then
 * composited into the adaptive icon's FOREGROUND. On a dark launcher plate it
 * showed as a white block wrapped around the M.
 *
 * That is the bug this file exists to not repeat: an adaptive icon foreground
 * must carry the artwork and nothing else, because the background is a separate
 * layer the launcher composites and masks independently.
 *
 * WHY `.trim()` AND NOT A HAND-ROLLED BOUNDING BOX
 * The previous version scanned for "ink" by looking for non-white pixels, which
 * is only necessary when the artwork is baked onto a background. With a
 * transparent source the real bounds are the alpha bounds, and sharp computes
 * those exactly.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');

/** The transparent mark. Never `public/logo-512.png` — see the note above. */
const SOURCE = resolve(frontend, 'src/assets/images/meetify_logo.webp');
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
 * The adaptive foreground's guaranteed-visible area is the middle 72dp of 108,
 * or 0.667. 0.48 sits comfortably inside that on every mask shape a launcher
 * might apply — circle, squircle, rounded square, teardrop — without the mark
 * touching an edge, which is what makes a masked icon look clipped.
 */
const SAFE_RATIO = 0.38;
const LEGACY_RATIO = 0.46;

/** The mark alone, for the opening screen and the PWA. */
const MARK_PUBLIC_PATH = resolve(frontend, 'public/logo-mark.png');
const MARK_PUBLIC_SIZE = 512;

/**
 * The PWA's maskable icons.
 *
 * A maskable icon is cropped by the OS to whatever shape it likes, and only the
 * inner circle of 80% diameter is guaranteed to survive.
 */
const MASKABLE_RATIO = 0.42;
const MASKABLE = {
  'public/logo-192-maskable.png': 192,
  'public/logo-512-maskable.png': 512,
};

/**
 * The mark, trimmed to its own alpha bounds and nothing else.
 *
 * `trim` on a transparent source removes the empty margin without touching a
 * single pixel of artwork. The returned metadata is the trimmed size, which is
 * what every composition below scales against.
 */
async function loadMark() {
  const buffer = await sharp(SOURCE).ensureAlpha().trim().png().toBuffer();
  const { width, height } = await sharp(buffer).metadata();
  return { buffer, width, height };
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

  const { buffer: mark, width, height } = await loadMark();
  const box = { width, height };
  console.log(`transparent mark, trimmed to ${width}x${height}`);
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
