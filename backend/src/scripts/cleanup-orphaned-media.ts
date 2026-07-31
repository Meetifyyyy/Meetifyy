import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/uploads.service';
import { Logger } from '@nestjs/common';

const logger = new Logger('CleanupOrphanedMedia');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);

  logger.log('Starting Orphaned Media Cleanup...');

  // 1. Find media for soft-deleted posts
  const orphanedPostMedia = await prisma.media.findMany({
    where: { post: { deletedAt: { not: null } } },
    select: { id: true, objectKey: true }
  });

  // 2. Find media for soft-deleted users (owners)
  const orphanedUserMedia = await prisma.media.findMany({
    where: { owner: { deletedAt: { not: null } } },
    select: { id: true, objectKey: true }
  });

  // Combine and deduplicate
  const allOrphans = [...orphanedPostMedia, ...orphanedUserMedia];
  const uniqueOrphans = Array.from(new Map(allOrphans.map(item => [item.id, item])).values());

  logger.log(`Found ${uniqueOrphans.length} orphaned media files to delete.`);

  for (const media of uniqueOrphans) {
    try {
      logger.log(`Deleting object from R2: ${media.objectKey}`);
      await storage.delete(media.objectKey); // This also deletes the DB row
      logger.log(`Successfully deleted ${media.objectKey}`);
    } catch (e) {
      logger.error(`Failed to delete ${media.objectKey}`, e);
    }
  }

  logger.log('Cleanup completed successfully.');
  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
