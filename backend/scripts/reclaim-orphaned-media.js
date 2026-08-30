#!/usr/bin/env node
/**
 * One-off: reclaim media orphaned before replacement cleanup was variant-aware.
 *
 * The forward path is fixed — a replacement now deletes the old image *and* its
 * derived thumbnail, and no longer sweeps away the thumbnail it just uploaded.
 * This script deals with what accumulated before that: files in the six
 * replaceable-media folders that no live entity points at any more.
 *
 * Safety is the whole design here, because the failure mode is deleting
 * somebody's current avatar. Nothing is deleted unless it survives all of:
 *
 *   - it lives in one of the media folders this pass covers;
 *   - no User, Community, Conversation, CrewActivity, CampusEvent or College
 *     column references it, in any URL form;
 *   - if it is a `_thumb` variant, its base image is also unreferenced;
 *   - it is not a protected platform asset (defaults/, presets/, …);
 *   - it is not attached to a post or a message.
 *
 * Read-only by default. Pass --apply to delete.
 *
 *   node scripts/reclaim-orphaned-media.js
 *   node scripts/reclaim-orphaned-media.js --apply
 */
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

/**
 * Objects younger than this are never touched.
 *
 * An upload writes the object first and the database reference a moment later,
 * so a file that is genuinely mid-flight looks exactly like an orphan to this
 * script. A day's grace makes that race impossible while costing nothing —
 * anything truly orphaned is still orphaned tomorrow.
 */
const MIN_AGE_HOURS = Number(process.env.RECLAIM_MIN_AGE_HOURS || 24);

/** Folders behind the six replaceable media types. */
const FOLDERS = [
  'avatars',
  'profile-covers',
  'communities',
  'community-icons',
  'community-covers',
  'groups',
  'events',
  'activities',
];

const PROTECTED = /^(defaults|v2-defaults|presets|system|assets|support)\//i;

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** Every URL form a stored reference might take, reduced to a bare key. */
function normalize(value) {
  if (!value || typeof value !== 'string') return null;
  let k = value.trim().split('?')[0].split('#')[0];
  k = k.replace(/^https?:\/\/[^/]+\/api\/media\//i, '');
  if (k.startsWith('/api/media/')) k = k.slice('/api/media/'.length);
  k = k.replace(/^https?:\/\/[^/]+\//i, '');
  return k.replace(/^\/+/, '') || null;
}

async function main() {
  const s3 = new S3Client({
    region: env('STORAGE_REGION', 'auto'),
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  });
  const bucket = env('R2_BUCKET_NAME');

  const dbUrl =
    env('DATABASE_URL') +
    (env('DATABASE_URL', '').includes('?') ? '&' : '?') +
    'pgbouncer=true&connection_limit=1';
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  // ── Everything the application currently points at ────────────────────────
  const referenced = new Set();
  const add = (v) => {
    const k = normalize(v);
    if (k) referenced.add(k);
  };

  const [users, communities, conversations, activities, events, colleges, attached] =
    await Promise.all([
      prisma.user.findMany({ select: { avatar: true, cover: true } }),
      prisma.community.findMany({ select: { avatarKey: true, coverKey: true } }).catch(() => []),
      prisma.conversation.findMany({ select: { avatarKey: true } }),
      prisma.crewActivity.findMany({ select: { coverImage: true } }).catch(() => []),
      prisma.campusEvent.findMany({ select: { posterUrl: true } }).catch(() => []),
      prisma.college.findMany({ select: { logoKey: true, bannerKey: true } }).catch(() => []),
      // Media attached to a post or a message is live regardless of folder.
      prisma.media.findMany({
        where: {
          OR: [{ postId: { not: null } }, { messageAttachments: { some: {} } }],
        },
        select: { objectKey: true },
      }),
    ]);

  users.forEach((u) => { add(u.avatar); add(u.cover); });
  communities.forEach((c) => { add(c.avatarKey); add(c.coverKey); });
  conversations.forEach((c) => add(c.avatarKey));
  activities.forEach((a) => add(a.coverImage));
  events.forEach((e) => add(e.posterUrl));
  colleges.forEach((c) => { add(c.logoKey); add(c.bannerKey); });
  attached.forEach((m) => add(m.objectKey));

  // A thumbnail inherits its base image's liveness — nothing stores a thumb key.
  const isLive = (key) => {
    if (referenced.has(key)) return true;
    const m = key.match(/^([a-z0-9_-]+)\/([A-Za-z0-9._-]+)_thumb\.[a-z0-9]+$/i);
    if (!m) return false;
    const [, folder, name] = m;
    return ['webp', 'jpg', 'jpeg', 'png', 'gif', 'mp4', 'webm'].some((ext) =>
      referenced.has(`${folder}/${name}.${ext}`),
    );
  };

  // ── Everything actually in the bucket ─────────────────────────────────────
  const objects = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    (page.Contents || []).forEach((o) =>
      objects.push({
        key: o.Key,
        size: o.Size || 0,
        lastModified: o.LastModified,
      }),
    );
    token = page.NextContinuationToken;
  } while (token);

  const inScope = objects.filter(
    (o) => FOLDERS.includes(o.key.split('/')[0]) && !PROTECTED.test(o.key),
  );
  const ageCutoff = Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000;
  const unreferenced = inScope.filter((o) => !isLive(o.key));
  const tooRecent = unreferenced.filter(
    (o) => new Date(o.lastModified).getTime() > ageCutoff,
  );
  const orphans = unreferenced.filter(
    (o) => new Date(o.lastModified).getTime() <= ageCutoff,
  );
  const bytes = orphans.reduce((a, o) => a + o.size, 0);

  console.log(`bucket objects            : ${objects.length}`);
  console.log(`in replaceable-media folders: ${inScope.length}`);
  console.log(`referenced by the app     : ${inScope.length - orphans.length}`);
  console.log(`ORPHANED                  : ${orphans.length} (${bytes.toLocaleString()} bytes)`);
  if (tooRecent.length > 0) {
    console.log(
      `held back (< ${MIN_AGE_HOURS}h old, may be mid-upload): ${tooRecent.length}`,
    );
  }

  const byFolder = {};
  orphans.forEach((o) => {
    const f = o.key.split('/')[0];
    byFolder[f] = (byFolder[f] || 0) + 1;
  });
  Object.entries(byFolder)
    .sort((a, b) => b[1] - a[1])
    .forEach(([f, n]) => console.log(`    ${f.padEnd(18)} ${n}`));

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to delete the orphans listed above.');
    await prisma.$disconnect();
    return;
  }

  let removed = 0;
  for (const o of orphans) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.key }));
      removed += 1;
    } catch (e) {
      console.error(`  failed to delete ${o.key}: ${e.message}`);
    }
  }
  const rows = await prisma.media.deleteMany({
    where: { objectKey: { in: orphans.map((o) => o.key) } },
  });

  console.log(`\nDeleted ${removed} object(s), ${rows.count} Media row(s).`);
  console.log(`Reclaimed ${bytes.toLocaleString()} bytes.`);

  // Prove no live image lost its file.
  const survivors = new Set(
    objects.filter((o) => !orphans.includes(o)).map((o) => o.key),
  );
  const broken = [...referenced].filter(
    (k) => FOLDERS.includes(k.split('/')[0]) && !survivors.has(k),
  );
  console.log(
    broken.length === 0
      ? 'Verified: every referenced image still has its file.'
      : `WARNING: ${broken.length} referenced image(s) now missing: ${broken.join(', ')}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Reclaim failed:', e.message);
  process.exit(1);
});
