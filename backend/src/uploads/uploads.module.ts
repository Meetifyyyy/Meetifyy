import { Module, Global } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';
import { DefaultAssetsService } from './default-assets.service';
import { MediaCleanupService } from './media-cleanup.service';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtGuard } from '../common/guards/jwt.guard';
import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [UploadsController],
  providers: [
    {
      // The provider reads its own settings from the central config layer.
      provide: 'STORAGE_PROVIDER',
      useClass: CloudflareR2Provider,
    },
    StorageService,
    DefaultAssetsService,
    MediaCleanupService,
    // The media routes stay reachable without a session — most media is public
    // — but resolve the viewer when there is one, so conversation attachments
    // can be authorized against the person asking.
    JwtGuard,
    OptionalJwtGuard,
  ],
  exports: [
    StorageService,
    DefaultAssetsService,
    MediaCleanupService,
    'STORAGE_PROVIDER',
  ],
})
export class UploadsModule {}
