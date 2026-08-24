import { Module, Global } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';
import { DefaultAssetsService } from './default-assets.service';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import { PrismaModule } from '../prisma/prisma.module';

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
  ],
  exports: [StorageService, DefaultAssetsService, 'STORAGE_PROVIDER'],
})
export class UploadsModule {}
