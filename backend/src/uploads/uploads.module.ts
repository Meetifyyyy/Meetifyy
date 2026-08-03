import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [UploadsController],
  providers: [
    {
      provide: 'STORAGE_PROVIDER',
      useFactory: (configService: ConfigService) => {
        return new CloudflareR2Provider(configService);
      },
      inject: [ConfigService],
    },
    StorageService,
  ],
  exports: [StorageService, 'STORAGE_PROVIDER'],
})
export class UploadsModule {}
