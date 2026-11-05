/**
 * Backfill the thumbnails old uploads are missing, and replace the black ones.
 *
 * The UI asks for `<original>_thumb.webp` beside every post image, avatar,
 * cover and video. Uploads made before the client got these right left three
 * kinds of gap, each of which every viewer then pays for on every load:
 *
 *   - a VIDEO whose poster is missing: the player has to load the clip itself
 *     to show a first frame;
 *   - a VIDEO whose poster is one flat colour: the old generator drew the
 *     frame before it was decoded, so posts got solid black thumbnails;
 *   - an IMAGE in a thumbnail folder with no `_thumb`: the grid downloads the
 *     full-size original instead.
 *
 * For each, this makes the thumbnail the current client would have made (the
 * same size, format and quality as mediaPipeline.js), stores it at the derived
 * key, and upserts its Media row the way UploadsService does for a variant:
 * same owner and visibility as the original, never over a row someone else
 * owns. Storage goes through CloudflareR2Provider, so chat media lands in the
 * private bucket exactly as an upload would.
 *
 * Read-only unless --apply. Development only: --apply refuses to run against
 * production (CI or the owner runs it there, never an agent).
 *
 *   npx ts-node scripts/backfill-media-thumbnails.ts                  # dry run
 *   npx ts-node scripts/backfill-media-thumbnails.ts --apply
 *   npx ts-node scripts/backfill-media-thumbnails.ts --only=videos --limit=20
 *   npx ts-node scripts/backfill-media-thumbnails.ts --preview=/tmp/thumbs   # look first
 *
 * Needs the `ffmpeg` and `ffprobe` binaries on PATH for videos. Thumbnails are
 * stored with the uploads' year-long immutable caching: a client that already
 * cached a black poster keeps it, which the app's blank-poster check covers.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import sharp from 'sharp';
import { config } from '../src/config';
import { CloudflareR2Provider } from '../src/uploads/providers/cloudflare-r2.provider';
import { errorMessage } from '../src/common/utils/error.util';

const APPLY = process.argv.includes('--apply');
/** Make the thumbnails and save them here instead of storing them (no writes). */
const PREVIEW_DIR = argValue('preview');
const ALLOW_PRODUCTION = process.argv.includes('--allow-production');
const ONLY = argValue('only'); // 'videos' | 'images' | undefined
const LIMIT = Number(argValue('limit') ?? Infinity);
const CONCURRENCY = 3;

/** Same as frontend DERIVED_THUMB_FOLDERS / thumbSizeForFolder. */
const IMAGE_THUMB_SIZE: Record<string, number> = {
  avatars: 160,
  groups: 160,
  'community-icons': 160,
  communities: 160,
  'profile-covers': 640,
  'community-covers': 640,
  events: 640,
  posts: 1080,
};
const IMAGE_QUALITY = 70; // generateImageThumbnail: 0.7
const POSTER_MAX = 720; // generateVideoPoster: maxSize
const POSTER_QUALITY = 75; // generateVideoPoster: 0.75
/** Luminance standard deviation (0-255) below which a frame is "flat". */
const FLAT_SD = 2.5;

type Action = 'ok' | 'missing' | 'flat' | 'skip';

interface Candidate {
  id: string;
  objectKey: string;
  mimeType: string;
  ownerId: string | null;
  visibility: string;
  kind: 'video' | 'image';
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** `posts/abc.mp4` → `posts/abc_thumb.webp`; null for anything else. */
export function thumbKeyFor(objectKey: string): string | null {
  if (/_thumb\.[a-z0-9]+$/i.test(objectKey)) return null;
  const m = /^(.*)\.([a-z0-9]+)$/i.exec(objectKey);
  return m ? `${m[1]}_thumb.webp` : null;
}

/** Output of a binary, as a Buffer; rejects on a non-zero exit. */
function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-300)}`));
    });
  });
}

/** True when the picture is (nearly) one flat colour — the client's rule. */
async function isFlat(image: Buffer): Promise<boolean> {
  const { channels } = await sharp(image)
    .resize(16, 16, { fit: 'fill' })
    .greyscale()
    .stats();
  return (channels[0]?.stdev ?? 0) < FLAT_SD;
}

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** A clip's length in seconds, read through HTTP range requests. */
async function durationOf(url: string): Promise<number> {
  const out = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    url,
  ]);
  const d = parseFloat(out.toString().trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** One decoded frame at `t` seconds, as PNG. */
function frameAt(url: string, t: number): Promise<Buffer> {
  return run('ffmpeg', [
    '-v',
    'error',
    '-ss',
    t.toFixed(3),
    '-i',
    url,
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    '-',
  ]);
}

/**
 * The first frame worth showing, tried at the same points as the client
 * (past a dark opening first, then further in). Null when every one is flat.
 */
async function posterFrom(url: string): Promise<Buffer | null> {
  const d = await durationOf(url);
  const points =
    d > 0 ? [Math.min(1, d / 2), d * 0.25, d * 0.5, d * 0.75] : [0];
  for (const t of [...new Set(points.map((p) => Number(p.toFixed(3))))]) {
    let png: Buffer;
    try {
      png = await frameAt(url, t);
    } catch {
      continue;
    }
    if (!png.length || (await isFlat(png))) continue;
    return sharp(png)
      .resize(POSTER_MAX, POSTER_MAX, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: POSTER_QUALITY })
      .toBuffer();
  }
  return null;
}

async function imageThumbFrom(
  url: string,
  maxSize: number,
): Promise<Buffer | null> {
  const original = await download(url);
  if (!original) return null;
  return sharp(original, { failOn: 'none' })
    .rotate() // EXIF orientation, as the browser applies it when drawing
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();
}

async function main(): Promise<void> {
  if (APPLY && config.isProduction && !ALLOW_PRODUCTION) {
    throw new Error(
      'Refusing to --apply against production. Run it from CI or as the owner with --allow-production.',
    );
  }
  if (ONLY !== 'images') {
    await run('ffprobe', ['-version']).catch(() => {
      throw new Error(
        'ffmpeg/ffprobe not found on PATH (needed for videos). Use --only=images to skip them.',
      );
    });
  }

  const dbHost = (() => {
    try {
      return new URL(config.database.url).host;
    } catch {
      return '(unparsable)';
    }
  })();
  console.log('Backfill media thumbnails');
  console.log(`  environment : ${config.env}`);
  console.log(`  database    : ${dbHost}`);
  console.log(`  bucket      : ${config.storage.r2.bucketName}`);
  console.log(
    `  mode        : ${APPLY ? 'APPLY (writes)' : PREVIEW_DIR ? `preview to ${PREVIEW_DIR} (no writes)` : 'dry run (no writes)'}`,
  );
  console.log('');

  const pool = new Pool({ connectionString: config.database.url, max: 3 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const storage = new CloudflareR2Provider();

  try {
    const rows = await prisma.media.findMany({
      where: {
        NOT: { objectKey: { contains: '_thumb.' } },
        OR: [
          // Live post media and everything that belongs to no post (chat,
          // avatars, covers); a deleted post's media is left alone.
          { postId: null },
          { post: { deletedAt: null } },
        ],
      },
      select: {
        id: true,
        objectKey: true,
        mimeType: true,
        ownerId: true,
        visibility: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const candidates: Candidate[] = [];
    for (const r of rows) {
      const folder = r.objectKey.split('/')[0];
      const isVideo = r.mimeType.startsWith('video/');
      const isImage =
        r.mimeType.startsWith('image/') && r.mimeType !== 'image/gif';
      if (isVideo && ONLY !== 'images')
        candidates.push({ ...r, kind: 'video' });
      else if (isImage && ONLY !== 'videos' && folder in IMAGE_THUMB_SIZE) {
        candidates.push({ ...r, kind: 'image' });
      }
    }
    const work = candidates.slice(0, LIMIT);
    console.log(
      `Checking ${work.length} originals (${work.filter((c) => c.kind === 'video').length} videos).`,
    );

    const totals: Record<string, number> = {
      ok: 0,
      missing: 0,
      flat: 0,
      skip: 0,
      written: 0,
      failed: 0,
      unfixable: 0,
    };

    const handle = async (c: Candidate): Promise<void> => {
      const thumbKey = thumbKeyFor(c.objectKey);
      if (!thumbKey) {
        totals.skip++;
        return;
      }
      let action: Action;
      try {
        if (!(await storage.exists(c.objectKey))) {
          action = 'skip';
          console.log(`skip     ${c.objectKey}  (original not in storage)`);
          totals.skip++;
          return;
        }
        if (!(await storage.exists(thumbKey))) {
          action = 'missing';
        } else if (c.kind === 'video') {
          const current = await download(
            await storage.createSignedDownloadUrl(thumbKey, 300),
          );
          action = current && (await isFlat(current)) ? 'flat' : 'ok';
        } else {
          action = 'ok';
        }
      } catch (e) {
        console.log(`failed   ${c.objectKey}  (${errorMessage(e)})`);
        totals.failed++;
        return;
      }
      totals[action]++;
      if (action === 'ok') return;
      console.log(`${action.padEnd(8)} ${thumbKey}`);
      if (!APPLY && !PREVIEW_DIR) return;

      try {
        const sourceUrl = await storage.createSignedDownloadUrl(
          c.objectKey,
          900,
        );
        const thumb =
          c.kind === 'video'
            ? await posterFrom(sourceUrl)
            : await imageThumbFrom(
                sourceUrl,
                IMAGE_THUMB_SIZE[c.objectKey.split('/')[0]],
              );
        if (!thumb) {
          // Every frame flat (a genuinely black clip) or an undecodable file.
          console.log(`         -> no usable frame; left as is`);
          totals.unfixable++;
          return;
        }
        const existing = await prisma.media.findUnique({
          where: { objectKey: thumbKey },
          select: { ownerId: true },
        });
        if (existing && existing.ownerId !== c.ownerId) {
          console.log(
            `         -> thumbnail row belongs to another owner; left as is`,
          );
          totals.skip++;
          return;
        }
        const { width, height } = await sharp(thumb).metadata();
        if (!APPLY) {
          // Preview: the file only, named after its key; storage and the
          // database are not touched.
          const file = path.join(
            PREVIEW_DIR as string,
            thumbKey.replace(/\//g, '__'),
          );
          fs.mkdirSync(PREVIEW_DIR as string, { recursive: true });
          fs.writeFileSync(file, thumb);
          console.log(
            `         -> preview ${file} (${thumb.length} bytes, ${width}x${height})`,
          );
          return;
        }
        await storage.upload(thumbKey, thumb, 'image/webp');
        const data = {
          ownerId: c.ownerId,
          objectKey: thumbKey,
          provider: config.storage.provider,
          bucket: config.storage.r2.bucketName,
          storageKey: thumbKey,
          type: 'IMAGE',
          mimeType: 'image/webp',
          fileSize: thumb.length,
          width: width ?? null,
          height: height ?? null,
          visibility: c.visibility,
        };
        await prisma.media.upsert({
          where: { objectKey: thumbKey },
          create: data,
          update: data,
        });
        totals.written++;
        console.log(
          `         -> written (${thumb.length} bytes, ${width}x${height})`,
        );
      } catch (e) {
        console.log(`         -> failed: ${errorMessage(e)}`);
        totals.failed++;
      }
    };

    // A small fixed pool: storage and ffmpeg calls, not CPU, set the pace.
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < work.length) await handle(work[next++]);
      }),
    );

    console.log('');
    console.log(
      `Done. ok=${totals.ok} missing=${totals.missing} flat=${totals.flat} skipped=${totals.skip}` +
        (APPLY
          ? ` written=${totals.written} unfixable=${totals.unfixable}`
          : '') +
        ` failed=${totals.failed}`,
    );
    if (!APPLY && totals.missing + totals.flat > 0) {
      console.log(
        'Dry run: nothing was written. Re-run with --apply to fix the listed thumbnails.',
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(errorMessage(e));
  process.exit(1);
});
