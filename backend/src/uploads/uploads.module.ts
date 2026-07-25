import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { SupabaseService } from '../supabase/supabase.service';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [SupabaseModule, PrismaModule],
  controllers: [UploadsController],
  providers: [
    {
      provide: 'STORAGE_PROVIDER',
      useFactory: (configService: ConfigService, supabaseService: SupabaseService) => {
        const provider = configService.get<string>('app.storageProvider') || 'supabase';
        if (provider === 'r2') {
          return new CloudflareR2Provider(configService);
        }
        return new SupabaseStorageProvider(configService, supabaseService);
      },
      inject: [ConfigService, SupabaseService],
    },
    StorageService,
  ],
  exports: [StorageService, 'STORAGE_PROVIDER'],
})
export class UploadsModule {}
