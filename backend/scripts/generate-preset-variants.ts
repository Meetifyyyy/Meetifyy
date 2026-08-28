import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'meetifyy-media';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev').replace(/\/+$/, '');

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Missing required Cloudflare R2 environment variables in backend/.env');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// Import current metadata
const currentPresetMediaPath = path.join(__dirname, '../../frontend/src/shared/constants/presetMedia.js');
const { PRESET_IMAGES, PRESET_GIFS } = require(currentPresetMediaPath);

async function existsInR2(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (err: any) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    return false;
  }
}

async function uploadBuffer(key: string, buffer: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

async function main() {
  console.log('====================================================');
  console.log('  Generating Preset Media Thumbnails & Poster WebPs ');
  console.log('====================================================');

  const enhancedImages: any[] = [];
  const enhancedGifs: any[] = [];

  // Phase 1: Images
  console.log('\nProcessing 36 Images...');
  for (let i = 0; i < PRESET_IMAGES.length; i++) {
    const item = PRESET_IMAGES[i];
    const themeSlug = (item.theme || 'other').toLowerCase().replace(/\s+/g, '-');
    const thumbKey = `presets/thumbnails/preset-image-${themeSlug}-${item.id}.webp`;
    const thumbUrl = `${R2_PUBLIC_URL}/${thumbKey}`;

    console.log(`[${i + 1}/${PRESET_IMAGES.length}] Image ${item.id} (${item.title})...`);

    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Failed to fetch image ${item.url}`);
    const origBuffer = Buffer.from(await res.arrayBuffer());
    const origMeta = await sharp(origBuffer).metadata();

    const exists = await existsInR2(thumbKey);
    let thumbSize = 0;
    if (!exists) {
      const thumbBuffer = await sharp(origBuffer)
        .resize({ width: 360, withoutEnlargement: true })
        .webp({ quality: 75, effort: 4 })
        .toBuffer();
      thumbSize = thumbBuffer.length;
      await uploadBuffer(thumbKey, thumbBuffer, 'image/webp');
      console.log(`  ✓ Created & uploaded thumbnail: ${thumbKey} (${thumbSize} bytes)`);
    } else {
      console.log(`  ✓ Thumbnail exists: ${thumbKey}`);
      thumbSize = Math.round(origBuffer.length * 0.25);
    }

    enhancedImages.push({
      id: item.id,
      title: item.title,
      theme: item.theme,
      category: item.category,
      tags: item.tags,
      url: item.url,
      thumbUrl,
      width: origMeta.width || 1200,
      height: origMeta.height || 800,
      size: origBuffer.length,
    });
  }

  // Phase 2: GIFs
  console.log('\nProcessing 46 GIFs...');
  for (let i = 0; i < PRESET_GIFS.length; i++) {
    const item = PRESET_GIFS[i];
    const themeSlug = (item.theme || 'other').toLowerCase().replace(/\s+/g, '-');
    const posterKey = `presets/posters/preset-gif-${themeSlug}-${item.id}.webp`;
    const posterUrl = `${R2_PUBLIC_URL}/${posterKey}`;

    console.log(`[${i + 1}/${PRESET_GIFS.length}] GIF ${item.id} (${item.title})...`);

    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Failed to fetch GIF ${item.url}`);
    const origBuffer = Buffer.from(await res.arrayBuffer());
    const gifMeta = await sharp(origBuffer, { animated: true }).metadata();

    const exists = await existsInR2(posterKey);
    let posterSize = 0;
    if (!exists) {
      // Extract frame 0 as static poster WebP
      const posterBuffer = await sharp(origBuffer, { pages: 1, page: 0 })
        .resize({ width: 360, withoutEnlargement: true })
        .webp({ quality: 75, effort: 4 })
        .toBuffer();
      posterSize = posterBuffer.length;
      await uploadBuffer(posterKey, posterBuffer, 'image/webp');
      console.log(`  ✓ Created & uploaded poster: ${posterKey} (${posterSize} bytes)`);
    } else {
      console.log(`  ✓ Poster exists: ${posterKey}`);
      posterSize = Math.round(origBuffer.length * 0.05);
    }

    enhancedGifs.push({
      id: item.id,
      title: item.title,
      theme: item.theme,
      category: item.category,
      tags: item.tags,
      url: item.url,
      posterUrl,
      width: gifMeta.width || 480,
      height: gifMeta.pageHeight || gifMeta.height || 360,
      frames: gifMeta.pages || 1,
      size: origBuffer.length,
    });
  }

  // Phase 3: Write updated presetMedia.js
  console.log('\nGenerating frontend presetMedia.js and backend manifest...');
  const themes = ['Party', 'Adventure', 'Study', 'Coffee', 'Walk', 'Coding'];
  const defaultCovers = enhancedImages.slice(0, 6).map((img) => img.url);

  const fileContent = `/**
 * PRESET MEDIA CONSTANTS
 * Hosted on Cloudflare R2 (meetifyy-media).
 * Includes optimized thumbnails, static poster frames, dimensions, and zero external API dependencies.
 */

export const PRESET_THEMES = ${JSON.stringify(themes, null, 2)};

/**
 * 36 Preset Images across all themes with thumbnails and dimensions.
 */
export const PRESET_IMAGES = ${JSON.stringify(enhancedImages, null, 2)};

/**
 * 46 Preset GIFs across all themes with static poster frames and frame counts.
 */
export const PRESET_GIFS = ${JSON.stringify(enhancedGifs, null, 2)};

/**
 * Deterministic fallback covers for activities.
 */
export const DEFAULT_ACTIVITY_COVERS = ${JSON.stringify(defaultCovers, null, 2)};

/**
 * Helper to get a deterministic cover from an activity ID or title.
 */
export function getDefaultActivityCover(idOrTitle = '') {
  const seed = String(idOrTitle || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return DEFAULT_ACTIVITY_COVERS[Math.abs(hash) % DEFAULT_ACTIVITY_COVERS.length];
}
`;

  fs.writeFileSync(currentPresetMediaPath, fileContent, 'utf-8');
  console.log(`  ✓ Wrote updated presetMedia.js (${enhancedImages.length} images, ${enhancedGifs.length} GIFs)`);

  // Write backend static manifest JSON
  const backendManifestPath = path.join(__dirname, '../src/uploads/preset-media.manifest.json');
  const manifestData = {
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    images: enhancedImages,
    gifs: enhancedGifs,
  };
  fs.writeFileSync(backendManifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');
  console.log(`  ✓ Wrote backend manifest to: ${backendManifestPath}`);

  console.log('\n====================================================');
  console.log('  Variants Generation Complete!                     ');
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Fatal error during variant generation:', err);
  process.exit(1);
});
