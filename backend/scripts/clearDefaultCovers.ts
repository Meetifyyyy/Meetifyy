/**
 * clearDefaultCovers.ts
 *
 * One-time migration: clears the `cover` field on User rows and the `coverKey`
 * field on Community rows that still reference old platform-default cover images
 * (i.e. values containing `/api/media/defaults/`).
 *
 * After this runs, those rows will have null covers and the frontend will render
 * the theme-aware empty cover state (--empty-cover-bg) via CSS.
 *
 * Avatar fields are NOT touched by this script.
 *
 * Run with:
 *   cd backend && npx ts-node scripts/clearDefaultCovers.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Clear Default Covers Migration ===\n');

  const { count: userCoverCount } = await prisma.user.updateMany({
    where: {
      cover: { contains: '/api/media/defaults/' },
    },
    data: { cover: null },
  });
  console.log(`Cleared ${userCoverCount} user cover(s) -> null`);

  const { count: commCoverCount } = await prisma.community.updateMany({
    where: {
      coverKey: { contains: '/api/media/defaults/' },
    },
    data: { coverKey: null },
  });
  console.log(`Cleared ${commCoverCount} community cover(s) -> null`);

  const deletedMedia = await prisma.media.deleteMany({
    where: {
      objectKey: {
        in: [
          'defaults/profile-cover-v1.webp',
          'defaults/profile-cover-v2.webp',
          'defaults/community-cover-v1.webp',
          'defaults/community-cover-v2.webp',
        ],
      },
    },
  });
  console.log(`Deleted ${deletedMedia.count} orphaned cover Media row(s)`);

  console.log('\n=== Done ===');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
