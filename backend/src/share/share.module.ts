import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ShareController } from './share.controller';
import { SharePreviewService } from './share-preview.service';
import { ShareCardRenderer } from './share-card.renderer';
import { ShareCardCache } from './share-card.cache';

/**
 * External post sharing: the canonical link, its metadata, and its card.
 *
 * Kept out of PostsModule deliberately. Everything here is unauthenticated and
 * read-only, and it must not be able to reach the authenticated post-reading
 * code by accident — the two answer different questions about the same rows.
 * StorageService and MediaCleanupService arrive through the global
 * UploadsModule, so nothing here builds a second copy of media-URL logic.
 */
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ShareController],
  providers: [SharePreviewService, ShareCardRenderer, ShareCardCache],
  exports: [SharePreviewService],
})
export class ShareModule {}
