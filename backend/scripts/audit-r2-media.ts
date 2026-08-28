/**
 * Audit & Orphan Media Cleanup Script
 *
 * Scans Cloudflare R2 bucket for avatar and cover media objects across:
 * - avatars/
 * - profile-covers/
 * - community-icons/
 * - community-covers/
 * - groups/
 * - activities/
 * - events/
 * - colleges/
 *
 * Checks all active database references across:
 * - User (avatar, cover)
 * - Community (avatarKey, coverKey)
 * - Conversation (avatarKey)
 * - CrewActivity (coverImage)
 * - CampusEvent (posterUrl)
 * - College (logoKey, bannerKey)
 * - Media (active posts / attachments)
 * - Message (attachmentMedia)
 *
 * Excludes protected assets (defaults/*, v2-defaults/*, presets/*, system/*, assets/*, mock-*, preset-*, default-*, support/*).
 *
 * Usage:
 *   npx ts-node backend/scripts/audit-r2-media.ts [--dry-run]
 */

import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'meetifyy-media';

const isDryRun = process.argv.includes('--dry-run') || !process.argv.includes('--live');

const FOLDERS_TO_AUDIT = [
  'avatars',
  'profile-covers',
  'community-icons',
  'community-covers',
  'groups',
  'activities',
  'events',
  'colleges',
];

function isProtected(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.startsWith('defaults/') ||
    lower.startsWith('v2-defaults/') ||
    lower.startsWith('presets/') ||
    lower.startsWith('system/') ||
    lower.startsWith('assets/') ||
    lower.startsWith('mock-') ||
    lower.startsWith('support/') ||
    lower.includes('preset-') ||
    lower.includes('default-')
  );
}

async function runAudit() {
  console.log(`=======================================================`);
  console.log(`Cloudflare R2 Media Audit & Orphan Cleanup`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no files deleted)' : 'LIVE (deleting unreferenced files)'}`);
  console.log(`Bucket: ${R2_BUCKET}`);
  console.log(`=======================================================\n`);

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.warn('R2 credentials not configured. Skipping live R2 listing.');
    return;
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  // 1. Gather all active references from Database
  console.log('Gathering active media references from database...');

  const [
    users,
    communities,
    conversations,
    activities,
    events,
    colleges,
    mediaRows,
    messages,
  ] = await Promise.all([
    prisma.user.findMany({ select: { avatar: true, cover: true } }),
    prisma.community.findMany({ where: { deletedAt: null }, select: { avatarKey: true, coverKey: true } }),
    prisma.conversation.findMany({ select: { avatarKey: true } }),
    prisma.crewActivity.findMany({ where: { deletedAt: null }, select: { coverImage: true } }),
    prisma.campusEvent.findMany({ where: { deletedAt: null }, select: { posterUrl: true } }),
    prisma.college.findMany({ select: { logoKey: true, bannerKey: true } }),
    prisma.media.findMany({ select: { objectKey: true, postId: true } }),
    prisma.message.findMany({
      where: { attachmentMediaId: { not: null } },
      select: { attachmentMedia: { select: { objectKey: true } } },
    }),
  ]);

  const activeRefSet = new Set<string>();

  const addRef = (ref: string | null | undefined) => {
    if (!ref) return;
    const clean = ref
      .replace('/api/media/', '')
      .replace(/^https?:\/\/[^/]+\//, '')
      .split('?')[0]
      .split('#')[0]
      .trim();
    if (clean) activeRefSet.add(clean);
  };

  users.forEach((u) => {
    addRef(u.avatar);
    addRef(u.cover);
  });
  communities.forEach((c) => {
    addRef(c.avatarKey);
    addRef(c.coverKey);
  });
  conversations.forEach((c) => addRef(c.avatarKey));
  activities.forEach((a) => addRef(a.coverImage));
  events.forEach((e) => addRef(e.posterUrl));
  colleges.forEach((c) => {
    addRef(c.logoKey);
    addRef(c.bannerKey);
  });
  mediaRows.forEach((m) => {
    if (m.postId) addRef(m.objectKey);
  });
  messages.forEach((m) => {
    if (m.attachmentMedia?.objectKey) addRef(m.attachmentMedia.objectKey);
  });

  console.log(`Total active media references found in DB: ${activeRefSet.size}\n`);

  let totalR2Objects = 0;
  let totalProtected = 0;
  let totalActive = 0;
  let totalOrphans = 0;
  const orphanKeys: string[] = [];

  for (const folder of FOLDERS_TO_AUDIT) {
    console.log(`Scanning folder: ${folder}/ ...`);
    let continuationToken: string | undefined;

    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: `${folder}/`,
          ContinuationToken: continuationToken,
        }),
      );

      if (res.Contents) {
        for (const item of res.Contents) {
          const key = item.Key;
          if (!key || key.endsWith('/')) continue;
          totalR2Objects++;

          if (isProtected(key)) {
            totalProtected++;
            continue;
          }

          const isReferenced =
            activeRefSet.has(key) ||
            Array.from(activeRefSet).some((ref) => ref.includes(key) || key.includes(ref));

          if (isReferenced) {
            totalActive++;
          } else {
            totalOrphans++;
            orphanKeys.push(key);
            console.log(`  [ORPHAN] ${key} (${item.Size} bytes)`);

            if (!isDryRun) {
              try {
                await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
                await prisma.media.deleteMany({ where: { objectKey: key } });
                console.log(`    -> Deleted from R2`);
              } catch (delErr: any) {
                console.error(`    -> Deletion failed:`, delErr?.message);
              }
            }
          }
        }
      }

      continuationToken = res.NextContinuationToken;
    } while (continuationToken);
  }

  console.log(`\n=======================================================`);
  console.log(`Audit Summary:`);
  console.log(`Total R2 Objects Scanned: ${totalR2Objects}`);
  console.log(`Protected Assets:        ${totalProtected}`);
  console.log(`Active Referencing Files: ${totalActive}`);
  console.log(`Unreferenced Orphans:     ${totalOrphans}`);
  console.log(`=======================================================`);

  await prisma.$disconnect();
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
